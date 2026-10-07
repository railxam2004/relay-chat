import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
export const tokenHash = token => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, value] = stored.split(':');
  const actual = await derive(password, salt, 64);
  const expected = Buffer.from(value, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function publicUser(row) {
  return { id: row.id, username: row.username, displayName: row.display_name, bio: row.bio, color: row.color, createdAt: row.created_at };
}
export async function newSession(db, userId, days) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + days * 86400000);
  await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [tokenHash(token), userId, expiresAt]);
  return { token, expiresAt };
}
export async function getSession(db, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { rows } = await db.query('SELECT u.*,s.expires_at,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [tokenHash(token)]);
  return rows[0] || null;
}
