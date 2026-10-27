import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TelegramUser } from './auth';
import { calculateFormIndex, formIndexStart } from './form-index';
import { weightProgress, type Profile, type ProfileInput } from './profile';

export type AppUser = TelegramUser & {
  role: 'admin' | 'user';
  firstSeen: string;
  lastSeen: string;
};
type LegacyState = { adminId: number | null; users: AppUser[] };
export type Activity = { date: string; training: boolean; microTraining: boolean; walking: boolean };

const selectUsers = `
  SELECT u.id, u.first_name, u.last_name, u.username,
    CASE WHEN u.id = s.admin_id THEN 'admin' ELSE 'user' END AS role,
    u.first_seen AS firstSeen, u.last_seen AS lastSeen
  FROM users u CROSS JOIN app_settings s WHERE s.id = 1
`;

function mapUser(row: Record<string, unknown>): AppUser {
  return {
    id: row.id as number,
    first_name: row.first_name as string,
    ...(row.last_name === null ? {} : { last_name: row.last_name as string }),
    ...(row.username === null ? {} : { username: row.username as string }),
    role: row.role as AppUser['role'],
    firstSeen: row.firstSeen as string,
    lastSeen: row.lastSeen as string,
  };
}

export class Users {
  private db: DatabaseSync;

  constructor(file: string, legacyFile?: string) {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    try {
      chmodSync(file, 0o600);
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
      this.db.exec('BEGIN IMMEDIATE');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY CHECK (id > 0),
          first_name TEXT NOT NULL,
          last_name TEXT,
          username TEXT,
          first_seen TEXT NOT NULL,
          last_seen TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS app_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          admin_id INTEGER CHECK (admin_id > 0),
          legacy_imported INTEGER NOT NULL DEFAULT 0 CHECK (legacy_imported IN (0, 1))
        ) STRICT;
        INSERT OR IGNORE INTO app_settings (id) VALUES (1);
        CREATE TABLE IF NOT EXISTS daily_activity (
          user_id INTEGER NOT NULL REFERENCES users(id),
          date TEXT NOT NULL,
          training INTEGER NOT NULL DEFAULT 0 CHECK (training IN (0, 1)),
          walking INTEGER NOT NULL DEFAULT 0 CHECK (walking IN (0, 1)),
          PRIMARY KEY (user_id, date)
        ) STRICT;

      `);
      const columns = this.db.prepare('PRAGMA table_info(daily_activity)').all();
      if (!columns.some((column) => column.name === 'micro_training')) {
        this.db.exec('ALTER TABLE daily_activity ADD COLUMN micro_training INTEGER NOT NULL DEFAULT 0 CHECK (micro_training IN (0, 1))');
      }
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS body_profiles (
          user_id INTEGER PRIMARY KEY REFERENCES users(id),
          current_fat REAL CHECK (current_fat BETWEEN 1 AND 70),
          target_fat REAL CHECK (target_fat BETWEEN 1 AND 70),
          current_weight REAL CHECK (current_weight BETWEEN 20 AND 400),
          target_weight REAL CHECK (target_weight BETWEEN 20 AND 400),
          start_weight REAL CHECK (start_weight BETWEEN 20 AND 400)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS monthly_workout_goals (
          user_id INTEGER NOT NULL REFERENCES users(id),
          month TEXT NOT NULL,
          goal INTEGER NOT NULL CHECK (goal BETWEEN 1 AND 1000),
          PRIMARY KEY (user_id, month)
        ) STRICT;
        PRAGMA user_version = 5;
      `);
      const settings = this.db.prepare('SELECT legacy_imported FROM app_settings WHERE id = 1').get()!;
      if (!settings.legacy_imported) {
        if (legacyFile && existsSync(legacyFile)) this.importLegacy(legacyFile);
        this.db.exec('UPDATE app_settings SET legacy_imported = 1 WHERE id = 1');
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* транзакция могла не начаться */ }
      this.db.close();
      throw error;
    }
  }

  private importLegacy(file: string) {
    const state: LegacyState = JSON.parse(readFileSync(file, 'utf8'));
    if (!state || !Array.isArray(state.users) ||
        (state.adminId !== null && (!Number.isSafeInteger(state.adminId) || state.adminId <= 0))) {
      throw new Error('Некорректное старое хранилище пользователей; перенос отменён.');
    }
    const insert = this.db.prepare(`
      INSERT INTO users (id, first_name, last_name, username, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const user of state.users) {
      if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.first_name !== 'string' ||
          (user.last_name !== undefined && typeof user.last_name !== 'string') ||
          (user.username !== undefined && typeof user.username !== 'string') ||
          typeof user.firstSeen !== 'string' || typeof user.lastSeen !== 'string') {
        throw new Error('Некорректный пользователь в старом хранилище; перенос отменён.');
      }
      insert.run(user.id, user.first_name, user.last_name ?? null, user.username ?? null, user.firstSeen, user.lastSeen);
    }
    // Источник прав — ранее закреплённый ID, а не username или поле role в JSON.
    this.db.prepare('UPDATE app_settings SET admin_id = ? WHERE id = 1').run(state.adminId);
  }

  // Принимает только данные, прошедшие проверку подписи Telegram.
  identify(telegramUser: TelegramUser): AppUser {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (telegramUser.username?.toLowerCase() === 'nottofu') {
        this.db.prepare('UPDATE app_settings SET admin_id = ? WHERE id = 1 AND admin_id IS NULL')
          .run(telegramUser.id);
      }
      const now = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO users (id, first_name, last_name, username, first_seen, last_seen)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name,
          last_name = excluded.last_name, username = excluded.username, last_seen = excluded.last_seen
      `).run(telegramUser.id, telegramUser.first_name, telegramUser.last_name ?? null,
        telegramUser.username ?? null, now, now);
      const user = mapUser(this.db.prepare(selectUsers + ' AND u.id = ?').get(telegramUser.id)!);
      this.db.exec('COMMIT');
      return user;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  isAdmin(id: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM app_settings WHERE id = 1 AND admin_id = ?').get(id);
  }

  list(): AppUser[] {
    return this.db.prepare(selectUsers + ' ORDER BY u.first_seen, u.id').all().map(mapUser);
  }

  getActivity(userId: number, date: string): Activity {
    const row = this.db.prepare('SELECT training, micro_training, walking FROM daily_activity WHERE user_id = ? AND date = ?')
      .get(userId, date);
    return { date, training: !!row?.training, microTraining: !!row?.micro_training, walking: !!row?.walking };
  }

  getCalendarActivity(userId: number, start: string, end: string): Activity[] {
    return this.db.prepare(`SELECT date, training, micro_training, walking FROM daily_activity
      WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`).all(userId, start, end)
      .map((row) => ({ date: String(row.date), training: !!row.training,
        microTraining: !!row.micro_training, walking: !!row.walking }));
  }

  setActivity(userId: number, date: string, kind: 'training' | 'microTraining' | 'walking', completed: boolean): Activity {
    const statements = {
      microTraining: `INSERT INTO daily_activity (user_id, date, micro_training) VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET micro_training = excluded.micro_training`,
      training: `INSERT INTO daily_activity (user_id, date, training) VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET training = excluded.training`,
      walking: `INSERT INTO daily_activity (user_id, date, walking) VALUES (?, ?, ?)
        ON CONFLICT(user_id, date) DO UPDATE SET walking = excluded.walking`,
    };
    this.db.prepare(statements[kind]).run(userId, date, Number(completed));
    return this.getActivity(userId, date);
  }

  getProfile(userId: number): Profile {
    const row = this.db.prepare(`SELECT current_fat AS currentFat, target_fat AS targetFat,
      current_weight AS currentWeight, target_weight AS targetWeight, start_weight AS startWeight
      FROM body_profiles WHERE user_id = ?`).get(userId);
    return row ? { ...row } as Profile : {
      currentFat: null, targetFat: null, currentWeight: null, targetWeight: null, startWeight: null,
    };
  }

  setProfile(userId: number, input: ProfileInput): Profile {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.getProfile(userId);
      const start = old.startWeight === null || old.targetWeight !== input.targetWeight
        ? input.currentWeight : old.startWeight;
      this.db.prepare(`INSERT INTO body_profiles
        (user_id, current_fat, target_fat, current_weight, target_weight, start_weight)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
        current_fat = excluded.current_fat, target_fat = excluded.target_fat,
        current_weight = excluded.current_weight, target_weight = excluded.target_weight,
        start_weight = excluded.start_weight`).run(userId, input.currentFat, input.targetFat,
          input.currentWeight, input.targetWeight, start);
      const profile = this.getProfile(userId);
      this.db.exec('COMMIT');
      return profile;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  getFormIndex(userId: number, end: string) {
    const start = formIndexStart(end);
    const activities = this.getCalendarActivity(userId, start, end);
    const main = activities.filter((day) => day.training).length;
    const micro = activities.filter((day) => day.microTraining).length;
    const walking = activities.filter((day) => day.walking).length;
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(`${start}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return activities.find((day) => day.date === key) ?? { date: key, training: false, microTraining: false, walking: false };
    });
    return { start, end, main, micro, walking, score: calculateFormIndex(main, micro, walking), activities: days };
  }

  getDashboard(userId: number, date: string) {
    const profile = this.getProfile(userId);
    const count = this.db.prepare(`SELECT COALESCE(SUM(training), 0) AS training,
      COALESCE(SUM(micro_training), 0) AS microTraining,
      COALESCE(SUM(CASE WHEN training = 1 OR micro_training = 1 THEN 1 ELSE 0 END), 0) AS total
      FROM daily_activity
      WHERE user_id = ? AND substr(date, 1, 7) = ?`).get(userId, date.slice(0, 7))!;
    const goalRow = this.db.prepare('SELECT goal FROM monthly_workout_goals WHERE user_id = ? AND month = ?')
      .get(userId, date.slice(0, 7));
    const goal = goalRow ? Number(goalRow.goal) : null;
    const total = Number(count.total);
    return {
      profile, progress: weightProgress(profile), month: date.slice(0, 7),
      workouts: { training: Number(count.training), microTraining: Number(count.microTraining),
        total, goal, progress: goal === null ? null : Math.min(100, Math.round(total / goal * 100)) },
    };
  }

  setMonthlyWorkoutGoal(userId: number, date: string, goal: number | null) {
    const month = date.slice(0, 7);
    if (goal === null) {
      this.db.prepare('DELETE FROM monthly_workout_goals WHERE user_id = ? AND month = ?').run(userId, month);
    } else {
      this.db.prepare(`INSERT INTO monthly_workout_goals (user_id, month, goal) VALUES (?, ?, ?)
        ON CONFLICT(user_id, month) DO UPDATE SET goal = excluded.goal`).run(userId, month, goal);
    }
    return this.getDashboard(userId, date);
  }

  close(): void { this.db.close(); }
}
