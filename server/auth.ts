import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export function verifyInitData(raw: string, token: string, now = Date.now()): TelegramUser {
  if (!raw || raw.length > 16_384) throw new Error('Invalid credentials');
  const params = new URLSearchParams(raw);
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate fields');
  const hash = params.get('hash') ?? '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('Invalid signature');
  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) throw new Error('Invalid signature');
  const authDate = Number(params.get('auth_date'));
  const age = Math.floor(now / 1000) - authDate;
  if (!Number.isSafeInteger(authDate) || authDate <= 0 || age < -30 || age > 3600) {
    throw new Error('Expired credentials');
  }
  const user: unknown = JSON.parse(params.get('user') ?? 'null');
  if (!user || typeof user !== 'object' || !('id' in user) ||
      !Number.isSafeInteger(user.id) || Number(user.id) <= 0 ||
      !('first_name' in user) || typeof user.first_name !== 'string') {
    throw new Error('Invalid user');
  }
  const value = user as TelegramUser;
  return {
    id: value.id, first_name: value.first_name,
    ...(typeof value.last_name === 'string' ? { last_name: value.last_name } : {}),
    ...(typeof value.username === 'string' ? { username: value.username } : {}),
  };
}
