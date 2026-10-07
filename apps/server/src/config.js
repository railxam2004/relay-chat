import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

export function getConfig(overrides = {}) {
  const env = z.object({
    PORT: z.coerce.number().int().min(0).max(65535).default(3001),
    DB_DRIVER: z.enum(['postgres', 'pglite']).default(process.env.DATABASE_URL ? 'postgres' : 'pglite'),
    SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    MESSAGE_RATE_LIMIT: z.coerce.number().int().positive().default(120),
    MESSAGE_RATE_WINDOW_MS: z.coerce.number().int().positive().default(10000),
    API_RATE_LIMIT: z.coerce.number().int().positive().default(3000),
  }).parse(process.env);
  return {
    port: env.PORT, dbDriver: env.DB_DRIVER,
    databaseUrl: process.env.DATABASE_URL,
    pgliteDir: path.resolve(root, process.env.PGLITE_DIR || './data/relay'),
    redisUrl: process.env.REDIS_URL,
    elasticUrl: process.env.ELASTICSEARCH_URL,
    sessionDays: env.SESSION_DAYS,
    messageRateLimit: env.MESSAGE_RATE_LIMIT,
    messageRateWindow: env.MESSAGE_RATE_WINDOW_MS,
    apiRateLimit: env.API_RATE_LIMIT,
    origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001,http://127.0.0.1:3001,http://localhost:8080,capacitor://localhost,http://localhost,https://localhost,relay://app').split(',').map(x => x.trim()).filter(Boolean),
    webDir: path.join(root, 'apps/web/dist'),
    ...overrides,
  };
}
