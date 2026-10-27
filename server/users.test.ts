import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Users } from './users';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-db-'));
  return { dir, db: join(dir, 'fitness.sqlite'), legacy: join(dir, 'users.json') };
}
const original = {
  adminId: 101,
  users: [
    { id: 101, first_name: 'Admin', username: 'renamed', role: 'admin', firstSeen: '2026-10-26T00:00:00.000Z', lastSeen: '2026-10-27T00:00:00.000Z' },
    { id: 202, first_name: 'User', username: 'NotTofu', role: 'user', firstSeen: '2026-10-26T00:00:00.000Z', lastSeen: '2026-10-27T00:00:00.000Z' },
  ],
};

test('migrates JSON once, preserves IDs, admin binding and dates; original file stays intact', () => {
  const f = fixture();
  const source = JSON.stringify(original);
  writeFileSync(f.legacy, source);
  let users = new Users(f.db, f.legacy);
  try {
    assert.deepEqual(users.list(), original.users);
    assert.equal(users.isAdmin(101), true);
    assert.equal(users.isAdmin(202), false);
    assert.equal(readFileSync(f.legacy, 'utf8'), source);
    const updated = users.identify({ id: 101, first_name: "O'Brien'; DROP TABLE users;--" });
    assert.equal(updated.role, 'admin');
    assert.equal(updated.username, undefined);
    assert.equal(updated.firstSeen, original.users[0].firstSeen);
    assert.notEqual(updated.lastSeen, original.users[0].lastSeen);
    users.close();
    users = new Users(f.db, f.legacy);
    assert.equal(users.list()[0].first_name, updated.first_name);
    assert.equal(users.list().length, 2);
    assert.equal(users.identify({ id: 202, first_name: 'User', username: 'NotTofu' }).role, 'user');
  } finally { users.close(); rmSync(f.dir, { recursive: true, force: true }); }
});

test('invalid legacy file rolls back all imported rows; corrected file can be imported', () => {
  const f = fixture();
  try {
    writeFileSync(f.legacy, JSON.stringify({ ...original, users: [...original.users, { id: -1 }] }));
    assert.throws(() => new Users(f.db, f.legacy));
    const db = new DatabaseSync(f.db);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name = 'users'").get()!.count, 0);
    db.close();
    writeFileSync(f.legacy, JSON.stringify(original));
    const users = new Users(f.db, f.legacy);
    try { assert.equal(users.list().length, 2); }
    finally { users.close(); }
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('two database connections see new users and cannot reassign administrator', () => {
  const f = fixture();
  const first = new Users(f.db);
  const second = new Users(f.db);
  try {
    first.identify({ id: 101, first_name: 'Admin', username: 'NotTofu' });
    assert.equal(second.isAdmin(101), true);
    assert.equal(second.identify({ id: 202, first_name: 'Other', username: 'NotTofu' }).role, 'user');
    assert.equal(first.list().length, 2);
    assert.equal(second.list().length, 2);
  } finally { first.close(); second.close(); rmSync(f.dir, { recursive: true, force: true }); }
});
