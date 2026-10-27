import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { verifyInitData, type TelegramUser } from './auth';
import { Users } from './users';
import { createApp } from './app';

const token = 'test-token-only';
function signed(user: TelegramUser, date = Math.floor(Date.now() / 1000)) {
  const fields = new URLSearchParams({ auth_date: String(date), user: JSON.stringify(user), signature: 'test-signature' });
  fields.sort();
  const check = [...fields].map(([key, value]) => `${key}=${value}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(token).digest();
  fields.set('hash', createHmac('sha256', key).update(check).digest('hex'));
  return fields.toString();
}
const admin = { id: 101, first_name: 'Admin', username: 'NotTofu' };
const ordinary = { id: 202, first_name: 'User', username: 'other' };

test('checks signatures, tampering, token, expiry, future dates, duplicates and missing fields', () => {
  assert.deepEqual(verifyInitData(signed(admin), token), admin);
  const changed = new URLSearchParams(signed(ordinary));
  changed.set('user', JSON.stringify(admin));
  assert.throws(() => verifyInitData(changed.toString(), token));
  assert.throws(() => verifyInitData(signed(admin), 'wrong-token'));
  assert.throws(() => verifyInitData(signed(admin, Math.floor(Date.now() / 1000) - 3601), token));
  assert.throws(() => verifyInitData(signed(admin, Math.floor(Date.now() / 1000) + 120), token));
  assert.throws(() => verifyInitData(signed(admin) + '&auth_date=1', token));
  assert.throws(() => verifyInitData('user={}', token));
});

test('pins admin ID durably and never transfers rights with username', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-users-'));
  let users = new Users(join(dir, 'fitness.sqlite'));
  try {
    assert.equal(users.identify(ordinary).role, 'user');
    assert.equal(users.identify(admin).role, 'admin');
    users.close();
    users = new Users(join(dir, 'fitness.sqlite'));
    assert.equal(users.identify({ ...admin, username: 'renamed' }).role, 'admin');
    assert.equal(users.identify({ ...ordinary, username: 'NotTofu' }).role, 'user');
    assert.equal(users.list().length, 2);
  } finally { users.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('HTTP API rejects unauthenticated and regular users; admin can list users', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-api-'));
  const users = new Users(join(dir, 'fitness.sqlite'));
  const server = createApp(token, users);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/api/admin/users')).status, 401);
    assert.equal((await fetch(base + '/api/auth', {
      method: 'POST', body: JSON.stringify({ initData: 'fake', role: 'admin' }),
    })).status, 401);
    for (const user of [ordinary, admin]) {
      const response = await fetch(base + '/api/auth', {
        method: 'POST', body: JSON.stringify({ initData: signed(user) }),
      });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).user.role, user.id === admin.id ? 'admin' : 'user');
    }
    assert.equal((await fetch(base + '/api/admin/users', {
      headers: { Authorization: `tma ${signed(ordinary)}` },
    })).status, 403);
    const response = await fetch(base + '/api/admin/users', {
      headers: { Authorization: `tma ${signed(admin)}` },
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).users.length, 2);
    assert.equal((await fetch(base + '/.env')).status, 404);
    assert.equal((await fetch(base + '/data/users.json')).status, 404);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    users.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
