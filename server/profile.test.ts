import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { Users } from './users';
import { createApp } from './app';
import { validateProfile, weightProgress } from './profile';

const initial = { currentFat: 22, targetFat: 18, currentWeight: 90, targetWeight: 80 };

test('weight progress handles loss, gain, overshoot, regression, missing data and equal weights', () => {
  const profile = { ...initial, startWeight: 90 };
  assert.equal(weightProgress({ ...profile, currentWeight: 85 }), 50);
  assert.equal(weightProgress({ ...profile, currentWeight: 95 }), 0);
  assert.equal(weightProgress({ ...profile, currentWeight: 75 }), 100);
  assert.equal(weightProgress({ ...profile, startWeight: 70, currentWeight: 75 }), 50);
  assert.equal(weightProgress({ ...profile, currentWeight: null }), null);
  assert.equal(weightProgress({ ...profile, startWeight: 80, currentWeight: 80 }), 100);
  assert.equal(weightProgress({ ...profile, startWeight: 80, currentWeight: 81 }), 0);
});

test('profile validates measurements, including explicit empty values', () => {
  assert.deepEqual(validateProfile(initial), initial);
  assert.equal(validateProfile({ ...initial, currentFat: null }).currentFat, null);
  for (const bad of [null, {}, { ...initial, currentWeight: -2 }, { ...initial, currentFat: 71 },
    { ...initial, targetWeight: '80' }, { ...initial, targetWeight: Infinity }, { ...initial, currentWeight: 85.123 }]) {
    assert.throws(() => validateProfile(bad));
  }
});

test('profile persists, baseline survives weigh-ins; monthly workout total excludes walks and other users', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-profile-'));
  const file = join(dir, 'fitness.sqlite');
  let users = new Users(file);
  try {
    for (const id of [101, 202]) users.identify({ id, first_name: 'Test' });
    users.setProfile(101, initial);
    users.setProfile(101, { ...initial, currentWeight: 85 });
    users.setActivity(101, '2026-10-25', 'training', true);
    users.setActivity(101, '2026-10-25', 'microTraining', true);
    users.setActivity(101, '2026-10-25', 'training', true);
    users.setActivity(101, '2026-10-26', 'walking', true);
    users.setActivity(101, '2026-09-30', 'training', true);
    users.setActivity(202, '2026-10-25', 'training', true);
    users.close();
    users = new Users(file);
    const dashboard = users.getDashboard(101, '2026-10-27');
    assert.equal(dashboard.progress, 50);
    assert.equal(dashboard.profile.startWeight, 90);
    assert.deepEqual(dashboard.workouts, { training: 1, microTraining: 1, total: 1, goal: null, progress: null });
    assert.equal(users.getProfile(202).currentWeight, null);
    users.setProfile(101, { ...initial, currentWeight: 85, targetWeight: 75 });
    assert.equal(users.getProfile(101).startWeight, 85);
    assert.equal(users.getDashboard(101, '2026-10-27').progress, 0);
    users.setActivity(101, '2026-10-25', 'training', false);
    assert.equal(users.getDashboard(101, '2026-10-27').workouts.total, 1);
    users.setActivity(101, '2026-10-25', 'microTraining', false);
    assert.equal(users.getDashboard(101, '2026-10-27').workouts.total, 0);
    users.setActivity(101, '2026-10-24', 'training', true);
    users.setActivity(101, '2026-10-25', 'microTraining', true);
    assert.equal(users.getDashboard(101, '2026-10-27').workouts.total, 2);
  } finally { users.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('dashboard API authenticates, validates profile and isolates users', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-profile-api-'));
  const users = new Users(join(dir, 'fitness.sqlite'));
  const token = 'profile-test-token';
  const server = createApp(token, users);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/dashboard?timezone=Europe%2FMoscow`;
  function auth(id: number) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: 'Test' }) });
    params.sort();
    const key = createHmac('sha256', 'WebAppData').update(token).digest();
    params.set('hash', createHmac('sha256', key).update([...params].map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex'));
    return { Authorization: 'tma ' + params.toString(), 'Content-Type': 'application/json' };
  }
  try {
    assert.equal((await fetch(url)).status, 401);
    const saved = await fetch(url, { method: 'PATCH', headers: auth(101), body: JSON.stringify({ ...initial, userId: 202 }) });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).profile.currentWeight, 90);
    const other = await fetch(url, { headers: auth(202) });
    assert.equal((await other.json()).profile.currentWeight, null);
    const invalid = await fetch(url, { method: 'PATCH', headers: auth(101), body: JSON.stringify({ ...initial, targetWeight: -1 }) });
    assert.equal(invalid.status, 400);
    assert.equal(users.getProfile(101).targetWeight, 80);
    const goalUrl = url.replace('/api/dashboard', '/api/workout-goal');
    assert.equal((await fetch(goalUrl, { method: 'PATCH', body: JSON.stringify({ goal: 16 }) })).status, 401);
    const goalResponse = await fetch(goalUrl, { method: 'PATCH', headers: auth(101), body: JSON.stringify({ goal: 16, userId: 202 }) });
    assert.equal(goalResponse.status, 200);
    const goalData = await goalResponse.json();
    assert.equal(goalData.workouts.goal, 16);
    assert.equal(goalData.workouts.progress, 0);
    assert.equal(goalData.profile.currentWeight, 90);
    const otherGoal = await fetch(url, { headers: auth(202) });
    assert.equal((await otherGoal.json()).workouts.goal, null);
    for (const goal of [0, -1, 1.5, 1001, '16', true]) {
      assert.equal((await fetch(goalUrl, { method: 'PATCH', headers: auth(101), body: JSON.stringify({ goal }) })).status, 400);
    }
    const cleared = await fetch(goalUrl, { method: 'PATCH', headers: auth(101), body: JSON.stringify({ goal: null }) });
    assert.equal((await cleared.json()).workouts.goal, null);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    users.close(); rmSync(dir, { recursive: true, force: true });
  }
});


test('monthly workout goals persist, remain separate by month and cap progress at 100%', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-month-goal-'));
  const file = join(dir, 'fitness.sqlite');
  let users = new Users(file);
  try {
    users.identify({ id: 101, first_name: 'Test' });
    users.setMonthlyWorkoutGoal(101, '2026-10-27', 4);
    users.setActivity(101, '2026-10-27', 'training', true);
    users.setActivity(101, '2026-10-27', 'microTraining', true);
    users.setActivity(101, '2026-10-27', 'walking', true);
    users.close();
    users = new Users(file);
    let workouts = users.getDashboard(101, '2026-10-27').workouts;
    assert.equal(workouts.goal, 4);
    assert.equal(workouts.progress, 25);
    assert.equal(users.getDashboard(101, '2026-11-01').workouts.goal, null);
    users.setMonthlyWorkoutGoal(101, '2026-10-27', 1);
    workouts = users.getDashboard(101, '2026-10-27').workouts;
    assert.equal(workouts.total, 1);
    assert.equal(workouts.progress, 100);
    users.setMonthlyWorkoutGoal(101, '2026-10-27', null);
    assert.equal(users.getDashboard(101, '2026-10-27').workouts.progress, null);
    assert.equal(users.getDashboard(101, '2026-10-27').workouts.total, 1);
  } finally { users.close(); rmSync(dir, { recursive: true, force: true }); }
});
