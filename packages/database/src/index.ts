import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
export * from './schema';
export { and, eq, gt, desc, sql } from 'drizzle-orm';
export function connectDatabase(url: string) {
  const pool = new Pool({ connectionString: url, max: 25 });
  return { pool, db: drizzle(pool) };
}
export { hashPassword, verifyPassword } from './password';
export type { Pool, PoolClient } from 'pg';
