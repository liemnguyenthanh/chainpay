import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { connectDatabase } from './index';
import { migrate } from './migrate';

/** Synthetic data can only be created inside a fresh disposable schema. */
async function benchmark() {
  const input = process.env.BENCHMARK_DATABASE_URL;
  if (!input)
    throw new Error(
      'BENCHMARK_DATABASE_URL required; DATABASE_URL is deliberately ignored',
    );
  const schema = `benchmark_${randomBytes(12).toString('hex')}`;
  const admin = connectDatabase(input);
  let isolated: ReturnType<typeof connectDatabase> | undefined;
  try {
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(input);
    url.searchParams.set('options', `-c search_path=${schema}`);
    await migrate(url.toString());
    isolated = connectDatabase(url.toString());
    const pool = isolated.pool;
    const merchant = randomUUID();
    await pool.query(
      'INSERT INTO merchants(id,name,receiver_address,password_hash) VALUES($1,$2,$3,$4)',
      [
        merchant,
        'synthetic-benchmark-only',
        `0x${'1'.repeat(40)}`,
        'disabled-no-login',
      ],
    );
    await pool.query(
      `INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash,status,confirmed_at,created_at,updated_at)
      SELECT $1, 'synthetic-'||n, '84532:USDC:1250000',84532,'0x036cbd53842c5426634e7929541ec2318f3dcf7e',6,1250000,'0x1111111111111111111111111111111111111111',md5(n::text)||md5('synthetic-'||n),
      CASE WHEN n%3=0 THEN 'CONFIRMED' WHEN n%3=1 THEN 'PROCESSING' ELSE 'AWAITING_PAYMENT' END,
      CASE WHEN n%3=0 THEN timestamptz '2026-01-02 00:00:00+00' ELSE NULL END,
      timestamptz '2026-01-01 00:00:00+00' + (n/10)*interval '1 millisecond',
      timestamptz '2026-01-02 00:00:00+00'
      FROM generate_series(1,100000) n`,
      [merchant],
    );
    await pool.query('ANALYZE payments');
    const count = (await pool.query('SELECT count(*) FROM payments')).rows[0]
      .count;
    if (count !== '100000') throw new Error('Unexpected synthetic row count');
    const boundary = (
      await pool.query(
        'SELECT created_at,id FROM payments WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC OFFSET 89999 LIMIT 1',
        [merchant],
      )
    ).rows[0];
    const cases: [string, string, unknown[]][] = [
      [
        'First page (31 rows for limit 30)',
        'SELECT * FROM payments WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 31',
        [merchant],
      ],
      [
        'Deep compound cursor (after row 90000)',
        'SELECT * FROM payments WHERE merchant_id=$1 AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 31',
        [merchant, boundary.created_at, boundary.id],
      ],
      [
        'Status filter + deep cursor',
        'SELECT * FROM payments WHERE merchant_id=$1 AND status=$4 AND (created_at,id)<($2::timestamptz,$3::uuid) ORDER BY created_at DESC,id DESC LIMIT 31',
        [merchant, boundary.created_at, boundary.id, 'PROCESSING'],
      ],
      [
        'OFFSET comparison (measurement only; API never uses OFFSET)',
        'SELECT * FROM payments WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC OFFSET 90000 LIMIT 31',
        [merchant],
      ],
    ];
    const version = (await pool.query('SELECT version()')).rows[0].version;
    let report = `# Phase 4 synthetic pagination measurement\n\nMeasured ${new Date().toISOString()} on local PostgreSQL.\n\n${version}\n\nExactly ${count} synthetic payments; one disabled-login merchant; timestamps deliberately tied in groups of ten; status evenly distributed. Fresh random schema, forced search_path, no real application rows read/written. Schema dropped in finally. No network/HTTP latency included. Single EXPLAIN run per query after ANALYZE; warm local cache, not a production benchmark or throughput claim.\n`;
    for (const [name, query, params] of cases) {
      const result = await pool.query(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`,
        params,
      );
      report += `\n## ${name}\n\n\`\`\`sql\n${query}\n\`\`\`\n\n\`\`\`text\n${result.rows.map((row: Record<string, string>) => row['QUERY PLAN']).join('\n')}\n\`\`\`\n`;
    }
    await writeFile(
      process.env.BENCHMARK_REPORT_PATH ?? '../../docs/phase4-benchmark.md',
      report,
    );
    console.log('Measured 100000 isolated synthetic payments; report written.');
  } finally {
    await isolated?.pool.end();
    await admin.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.pool.end();
  }
}
void benchmark().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Benchmark failed');
  process.exitCode = 1;
});
