import { resolve } from 'node:path';
import { createApp } from './app';
import { Users } from './users';

const token = process.env.BOT_TOKEN?.trim();
if (!token) throw new Error('Укажите BOT_TOKEN в .env');
const port = Number(process.env.PORT ?? 5173);
const users = new Users(resolve('data/fitness.sqlite'), resolve('data/users.json'));
const server = createApp(token, users);
server.listen(port, '127.0.0.1', () => console.info(`Сервер: http://127.0.0.1:${port}`));
server.on('close', () => users.close());
server.on('error', () => { users.close(); console.error('Не удалось запустить сервер. Проверьте порт.'); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close());
}
