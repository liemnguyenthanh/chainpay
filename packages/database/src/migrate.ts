import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connectDatabase } from './index';
export async function migrate(url: string) {
  const { pool } = connectDatabase(url);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(710001)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)',
    );
    const names = (await readdir(join(__dirname, '../migrations')))
      .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name))
      .sort();
    for (const name of names) {
      const source = await readFile(
        join(__dirname, '../migrations', name),
        'utf8',
      );
      const checksum = createHash('sha256').update(source).digest('hex');
      const prior = await client.query(
        'SELECT checksum FROM schema_migrations WHERE name=$1',
        [name],
      );
      if (prior.rows.length && prior.rows[0].checksum !== checksum)
        throw new Error('Applied migration changed');
      if (!prior.rows.length) {
        await client.query(source);
        await client.query('INSERT INTO schema_migrations VALUES ($1,$2)', [
          name,
          checksum,
        ]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
if (require.main === module) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
  void migrate(process.env.DATABASE_URL).catch(() => {
    console.error('Migration failed');
    process.exitCode = 1;
  });
}
