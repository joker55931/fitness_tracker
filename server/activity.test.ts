import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { Users } from './users';
import { createApp } from './app';
import { todayInTimezone, validateActivityDate } from './activity';

const token = 'activity-test-token';
function credentials(id: number) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Test' }) });
  params.sort();
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  const data = [...params].map(([key, value]) => `${key}=${value}`).join('\n');
  params.set('hash', createHmac('sha256', key).update(data).digest('hex'));
  return 'tma ' + params.toString();
}

test('today respects timezone at midnight', () => {
  const now = new Date('2026-10-27T21:30:00Z');
  assert.equal(todayInTimezone('Europe/Moscow', now), '2026-10-28');
  assert.equal(todayInTimezone('America/New_York', now), '2026-10-27');
  assert.throws(() => todayInTimezone('invalid/zone', now));
});

test('SQLite upgrade preserves existing marks; three marks persist independently across users and dates', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-activity-'));
  const file = join(dir, 'fitness.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE daily_activity (
    user_id INTEGER NOT NULL, date TEXT NOT NULL, training INTEGER NOT NULL DEFAULT 0,
    walking INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, date)) STRICT;
    INSERT INTO daily_activity VALUES (101, '2026-10-27', 1, 1);`);
  db.close();
  let users = new Users(file);
  try {
    users.identify({ id: 101, first_name: 'A' });
    users.identify({ id: 202, first_name: 'B' });
    assert.deepEqual(users.getActivity(101, '2026-10-27'), { date: '2026-10-27', training: true, microTraining: false, walking: true });
    users.setActivity(101, '2026-10-27', 'microTraining', true);
    users.setActivity(101, '2026-10-27', 'training', false);
    users.close();
    users = new Users(file);
    assert.deepEqual(users.getActivity(101, '2026-10-27'), { date: '2026-10-27', training: false, microTraining: true, walking: true });
    assert.equal(users.getActivity(202, '2026-10-27').microTraining, false);
    assert.equal(users.getActivity(101, '2026-10-28').walking, false);
  } finally { users.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('API saves selected dates for authenticated user; rejects invalid input and cross-user spoofing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-activity-api-'));
  const users = new Users(join(dir, 'fitness.sqlite'));
  const server = createApp(token, users);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/activity?timezone=Europe%2FMoscow`;
  const today = todayInTimezone('Europe/Moscow');
  async function patch(input: unknown, id = 101) {
    return fetch(url, { method: 'PATCH', headers: { Authorization: credentials(id), 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  }
  try {
    assert.equal((await fetch(url)).status, 401);
    for (const kind of ['training', 'microTraining', 'walking']) {
      const response = await patch({ timezone: 'Europe/Moscow', date: today, kind, completed: true, userId: 202 });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).activity[kind], true);
    }
    const other = await fetch(url, { headers: { Authorization: credentials(202) } });
    assert.deepEqual((await other.json()).activity, { date: today, training: false, microTraining: false, walking: false });
    for (const date of ['2000-01-01', '2030-02-28']) {
      assert.equal((await patch({ timezone: 'Europe/Moscow', date, kind: 'training', completed: true })).status, 200);
      const selected = await fetch(url + '&date=' + date, { headers: { Authorization: credentials(101) } });
      assert.deepEqual((await selected.json()).activity, { date, training: true, microTraining: false, walking: false });
      const otherDate = await fetch(url + '&date=' + date, { headers: { Authorization: credentials(202) } });
      assert.equal((await otherDate.json()).activity.training, false);
    }
    assert.equal((await patch({ timezone: 'Europe/Moscow', date: '2026-02-30', kind: 'training', completed: true })).status, 400);
    const badDate = await fetch(url + '&date=not-a-date', { headers: { Authorization: credentials(101) } });
    assert.equal(badDate.status, 400);
    assert.equal((await patch({ timezone: 'bad', date: today, kind: 'training', completed: true })).status, 400);
    assert.equal((await patch({ timezone: 'Europe/Moscow', date: today, kind: 'admin', completed: true })).status, 400);
    assert.equal((await patch({ timezone: 'Europe/Moscow', date: today, kind: 'training', completed: 'true' })).status, 400);
    const calendarUrl = url.replace('/api/activity?timezone=Europe%2FMoscow', '/api/calendar?start=2000-01-01&end=2000-01-31');
    assert.equal((await fetch(calendarUrl)).status, 401);
    const calendar = await fetch(calendarUrl, { headers: { Authorization: credentials(101) } });
    assert.equal(calendar.status, 200);
    assert.deepEqual((await calendar.json()).activities, [{ date: '2000-01-01', training: true, microTraining: false, walking: false }]);
    const otherCalendar = await fetch(calendarUrl, { headers: { Authorization: credentials(202) } });
    assert.deepEqual((await otherCalendar.json()).activities, []);
    const reversed = await fetch(calendarUrl.replace('end=2000-01-31', 'end=1999-12-31'), { headers: { Authorization: credentials(101) } });
    assert.equal(reversed.status, 400);
    const tooLong = await fetch(calendarUrl.replace('end=2000-01-31', 'end=2002-01-01'), { headers: { Authorization: credentials(101) } });
    assert.equal(tooLong.status, 400);
    const removed = await patch({ timezone: 'Europe/Moscow', date: today, kind: 'microTraining', completed: false });
    assert.deepEqual((await removed.json()).activity, { date: today, training: true, microTraining: false, walking: true });
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    users.close();
    rmSync(dir, { recursive: true, force: true });
  }
});


test('selected date validation handles leap years and rejects rollover dates and malformed values', () => {
  assert.equal(validateActivityDate('2028-02-29'), '2028-02-29');
  for (const value of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-1', 'bad', null, 20261027]) {
    assert.throws(() => validateActivityDate(value));
  }
});
