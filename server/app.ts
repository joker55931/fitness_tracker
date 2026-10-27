import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { verifyInitData } from './auth';
import { Users } from './users';
import { todayInTimezone, validateActivityDate } from './activity';
import { validateProfile } from './profile';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 20_000) throw new Error('Body too large');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export function createApp(token: string, users: Users, root = resolve('dist')) {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const requestUrl = new URL(req.url ?? '/', 'http://localhost');
      const path = requestUrl.pathname;
      if (path.startsWith('/api/')) {
        if (path === '/api/auth' && req.method === 'POST') {
          let user;
          try {
            const input = await body(req);
            if (typeof input?.initData !== 'string') throw new Error('Missing credentials');
            user = verifyInitData(input.initData, token);
          } catch {
            json(res, 401, { error: 'Открой приложение заново через Telegram.' });
            return;
          }
          json(res, 200, { user: users.identify(user) });
          return;
        }
        if (path === '/api/workout-goal' && req.method === 'PATCH') {
          let user;
          try {
            const header = req.headers.authorization ?? '';
            if (!header.startsWith('tma ')) throw new Error('Missing credentials');
            user = verifyInitData(header.slice(4), token);
          } catch {
            json(res, 401, { error: 'Открой приложение заново через Telegram.' });
            return;
          }
          let date: string;
          let goal: number | null;
          try {
            date = todayInTimezone(requestUrl.searchParams.get('timezone'));
            const input = await body(req);
            if (input.goal !== null && (typeof input.goal !== 'number' || !Number.isInteger(input.goal) || input.goal < 1 || input.goal > 1000)) {
              throw new Error('Invalid goal');
            }
            goal = input.goal as number | null;
          } catch {
            json(res, 400, { error: 'Укажи целое число тренировок от 1 до 1000.' });
            return;
          }
          users.identify(user);
          json(res, 200, users.setMonthlyWorkoutGoal(user.id, date, goal));
          return;
        }
        if (path === '/api/dashboard' && (req.method === 'GET' || req.method === 'PATCH')) {
          let user;
          try {
            const header = req.headers.authorization ?? '';
            if (!header.startsWith('tma ')) throw new Error('Missing credentials');
            user = verifyInitData(header.slice(4), token);
          } catch {
            json(res, 401, { error: 'Открой приложение заново через Telegram.' });
            return;
          }
          let date: string;
          let profile;
          try {
            date = todayInTimezone(requestUrl.searchParams.get('timezone'));
            if (req.method === 'PATCH') profile = validateProfile(await body(req));
          } catch {
            json(res, 400, { error: 'Проверь значения: жир от 1 до 70%, вес от 20 до 400 кг, не более одного знака после запятой.' });
            return;
          }
          users.identify(user);
          if (profile) users.setProfile(user.id, profile);
          json(res, 200, users.getDashboard(user.id, date));
          return;
        }
        if (path === '/api/form-index' && req.method === 'GET') {
          let user;
          try {
            const header = req.headers.authorization ?? '';
            if (!header.startsWith('tma ')) throw new Error('Missing credentials');
            user = verifyInitData(header.slice(4), token);
          } catch {
            json(res, 401, { error: 'Открой приложение заново через Telegram.' });
            return;
          }
          let end: string;
          try { end = todayInTimezone(requestUrl.searchParams.get('timezone')); }
          catch { json(res, 400, { error: 'Некорректный часовой пояс.' }); return; }
          json(res, 200, users.getFormIndex(user.id, end));
          return;
        }
        if (path === '/api/calendar' && req.method === 'GET') {
          let user;
          try {
            const header = req.headers.authorization ?? '';
            if (!header.startsWith('tma ')) throw new Error('Missing credentials');
            user = verifyInitData(header.slice(4), token);
          } catch {
            json(res, 401, { error: 'Открой приложение заново через Telegram.' });
            return;
          }
          let start: string;
          let end: string;
          try {
            start = validateActivityDate(requestUrl.searchParams.get('start'));
            end = validateActivityDate(requestUrl.searchParams.get('end'));
            const days = (Date.parse(end) - Date.parse(start)) / 86400000;
            if (days < 0 || days > 366) throw new Error('Invalid range');
          } catch {
            json(res, 400, { error: 'Некорректный диапазон календаря.' });
            return;
          }
          json(res, 200, { activities: users.getCalendarActivity(user.id, start, end) });
          return;
        }
        if (path === '/api/activity' && (req.method === 'GET' || req.method === 'PATCH')) {
          let user;
          try {
            const header = req.headers.authorization ?? '';
            if (!header.startsWith('tma ')) throw new Error('Missing credentials');
            user = verifyInitData(header.slice(4), token);
          } catch {
            json(res, 401, { error: 'Открой приложение заново через Telegram.' });
            return;
          }
          let input: Record<string, unknown> = {};
          let date: string;
          try {
            if (req.method === 'PATCH') input = await body(req);
            const today = todayInTimezone(req.method === 'GET' ? requestUrl.searchParams.get('timezone') : input.timezone);
            const requestedDate = req.method === 'GET' ? requestUrl.searchParams.get('date') : input.date;
            date = req.method === 'GET' && requestedDate === null ? today : validateActivityDate(requestedDate);
            if (req.method === 'PATCH' &&
                ((input.kind !== 'training' && input.kind !== 'microTraining' && input.kind !== 'walking') || typeof input.completed !== 'boolean')) {
              throw new Error('Invalid activity');
            }
          } catch {
            json(res, 400, { error: 'Некорректная отметка, дата или часовой пояс.' });
            return;
          }
          users.identify(user);
          const activity = req.method === 'GET' ? users.getActivity(user.id, date)
            : users.setActivity(user.id, date, input.kind as 'training' | 'microTraining' | 'walking', input.completed as boolean);
          json(res, 200, { activity });
          return;
        }
        if (path === '/api/admin/users' && req.method === 'GET') {
          let user;
          try {
            const header = req.headers.authorization ?? '';
            if (!header.startsWith('tma ')) throw new Error('Missing credentials');
            user = verifyInitData(header.slice(4), token);
          } catch {
            json(res, 401, { error: 'Открой приложение заново через Telegram.' });
            return;
          }
          if (!users.isAdmin(user.id)) {
            json(res, 403, { error: 'Доступ только для администратора.' });
            return;
          }
          json(res, 200, { users: users.list() });
          return;
        }
        json(res, 404, { error: 'Не найдено' });
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405); res.end(); return;
      }
      const file = resolve(root, '.' + decodeURIComponent(path === '/' ? '/index.html' : path));
      if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return; }
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
      };
      let content: Buffer;
      try { content = await readFile(file); }
      catch { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      json(res, 500, { error: 'Ошибка сервера. Попробуй позже.' });
    }
  });
}
