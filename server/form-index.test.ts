import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateFormIndex, formIndexStart } from './form-index';
import { Users } from './users';

test('form index matches example, rounds only final score and clamps to 100', () => {
  assert.equal(calculateFormIndex(4, 2, 6), 79);
  assert.equal(calculateFormIndex(1, 0, 0), 7);
  assert.equal(calculateFormIndex(0, 1, 0), 4);
  assert.equal(calculateFormIndex(1, 1, 0), 11);
  assert.equal(calculateFormIndex(0, 0, 1), 7);
  assert.equal(calculateFormIndex(7, 0, 7), 100);
  assert.equal(calculateFormIndex(7, 7, 7), 100);
  assert.equal(calculateFormIndex(0, 0, 0), 0);
});

test('seven-day window crosses months, years and leap day', () => {
  assert.equal(formIndexStart('2026-11-02'), '2026-10-27');
  assert.equal(formIndexStart('2026-01-03'), '2025-12-28');
  assert.equal(formIndexStart('2028-03-01'), '2028-02-24');
});

test('index uses last seven days including today; edits recalculate and users stay isolated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fitness-index-'));
  const users = new Users(join(dir, 'fitness.sqlite'));
  try {
    for (const id of [101, 202]) users.identify({ id, first_name: 'Test' });
    users.setActivity(101, '2026-10-21', 'training', true);
    users.setActivity(101, '2026-10-27', 'training', true);
    users.setActivity(101, '2026-10-27', 'microTraining', true);
    users.setActivity(101, '2026-10-27', 'walking', true);
    users.setActivity(101, '2026-10-20', 'training', true);
    users.setActivity(101, '2026-10-28', 'training', true);
    let index = users.getFormIndex(101, '2026-10-27');
    assert.equal(index.main, 2);
    assert.equal(index.micro, 1);
    assert.equal(index.walking, 1);
    assert.equal(index.score, 25);
    assert.equal(index.activities.length, 7);
    assert.equal(index.activities[0].date, '2026-10-21');
    assert.equal(index.activities[6].date, '2026-10-27');
    users.setActivity(101, '2026-10-27', 'microTraining', false);
    index = users.getFormIndex(101, '2026-10-27');
    assert.equal(index.score, 21);
    assert.equal(users.getFormIndex(202, '2026-10-27').score, 0);
    assert.equal(users.getFormIndex(202, '2026-10-27').activities.every((day) => !day.training && !day.microTraining && !day.walking), true);
  } finally { users.close(); rmSync(dir, { recursive: true, force: true }); }
});
