import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = (await derive(password, salt, 64)) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, hash: string) {
  const [salt, expected] = hash.split(':');
  if (!salt || !expected || !/^[0-9a-f]{128}$/.test(expected)) return false;
  const actual = (await derive(password, salt, 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(expected, 'hex'));
}
