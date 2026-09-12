/* eslint-disable @typescript-eslint/no-require-imports */
// Explicit synthetic-only read benchmark; never starts a verifier or submits a tx.
require('reflect-metadata');
const { randomBytes, createHash } = require('node:crypto');
const { writeFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { NestFactory } = require('@nestjs/core');
const { connectDatabase } = require('@chainpay/database');
const { migrate } = require('../../../packages/database/dist/migrate');
const { AppModule } = require('../dist/app.module');
const { configureHttp } = require('../dist/http');

async function main() {
  if (!process.env.BENCHMARK_DATABASE_URL)
    throw new Error(
      'BENCHMARK_DATABASE_URL required; no DATABASE_URL fallback',
    );
  const admin = connectDatabase(process.env.BENCHMARK_DATABASE_URL);
  const schema = `perf_${randomBytes(12).toString('hex')}`;
  let database, app, report;
  try {
    await admin.pool.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.BENCHMARK_DATABASE_URL);
    url.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = url.toString();
    process.env.MERCHANT_ORIGIN = 'https://localhost';
    await migrate(url.toString());
    database = connectDatabase(url.toString());
    const pool = database.pool;
    const {
      rows: [merchant],
    } = await pool.query(
      "INSERT INTO merchants(name,receiver_address,password_hash) VALUES('synthetic-performance-only','0x1111111111111111111111111111111111111111','disabled') RETURNING id",
    );
    await pool.query(
      `INSERT INTO payments(merchant_id,idempotency_key,normalized_request,chain_id,token_address,token_decimals,amount_base_units,receiver_address,checkout_token_hash,status,confirmed_at,created_at)
      SELECT $1,'synthetic-'||n,
      CASE WHEN n%2=0 THEN '80094:BERA:1000000000000000' ELSE '84532:USDC:1250000' END,
      CASE WHEN n%2=0 THEN 80094 ELSE 84532 END,
      CASE WHEN n%2=0 THEN '0x0000000000000000000000000000000000000000' ELSE '0x036cbd53842c5426634e7929541ec2318f3dcf7e' END,
      CASE WHEN n%2=0 THEN 18 ELSE 6 END,
      CASE WHEN n%2=0 THEN 1000000000000000 ELSE 1250000 END,
      '0x1111111111111111111111111111111111111111',md5(n::text)||md5('perf-'||n),
      CASE WHEN n%100=0 THEN 'PROCESSING' ELSE 'CONFIRMED' END,
      CASE WHEN n%100=0 THEN NULL ELSE timestamptz '2026-01-02' END,
      timestamptz '2026-01-01' + (n/10)*interval '1 millisecond'
      FROM generate_series(1,100000) n`,
      [merchant.id],
    );
    await pool.query('ANALYZE payments');
    const {
      rows: [counts],
    } = await pool.query(
      'SELECT count(*)::int AS total,count(*) FILTER(WHERE chain_id=80094)::int AS bera FROM payments',
    );
    if (counts.total !== 100000 || counts.bera !== 50000)
      throw Error('Unexpected seed count');
    const session = randomBytes(32).toString('base64url');
    await pool.query(
      "INSERT INTO merchant_sessions(token_hash,merchant_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [createHash('sha256').update(session).digest('hex'), merchant.id],
    );
    const {
      rows: [boundary],
    } = await pool.query(
      'SELECT id,created_at FROM payments ORDER BY created_at DESC,id DESC OFFSET 89999 LIMIT 1',
    );
    const cursor = Buffer.from(
      JSON.stringify([boundary.created_at.toISOString(), boundary.id]),
    ).toString('base64url');
    app = await NestFactory.create(AppModule, { logger: false });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    async function request(path) {
      const start = performance.now();
      const response = await fetch(origin + path, {
        headers: { cookie: `chainpay_merchant=${session}` },
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (
        response.status !== 200 ||
        !Array.isArray(body.data) ||
        body.data.length !== 30
      )
        throw Error(`Invalid benchmark response: ${response.status}`);
      if (
        path.includes('status=PROCESSING') &&
        body.data.some((row) => row.status !== 'PROCESSING')
      )
        throw Error('Filter mismatch');
      return performance.now() - start;
    }
    const scenarios = [
      ['First page', '/v1/payments?limit=30'],
      [
        'Deep cursor, after row 90000',
        `/v1/payments?limit=30&cursor=${cursor}`,
      ],
      [
        'Rare PROCESSING filter (1%)',
        '/v1/payments?limit=30&status=PROCESSING',
      ],
    ];
    const results = [];
    for (const [name, path] of scenarios) {
      for (let i = 0; i < 30; i++) await request(path);
      for (const concurrency of [1, 10, 25]) {
        const latencies = [];
        let errors = 0,
          issued = 0;
        const start = performance.now();
        await Promise.all(
          Array.from({ length: concurrency }, async () => {
            while (issued++ < 500) {
              try {
                latencies.push(await request(path));
              } catch {
                errors++;
              }
            }
          }),
        );
        const elapsed = (performance.now() - start) / 1000;
        latencies.sort((a, b) => a - b);
        const percentile = (p) =>
          latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? null;
        results.push({
          name,
          concurrency,
          requests: 500,
          errors,
          seconds: elapsed,
          rps: 500 / elapsed,
          p50: percentile(0.5),
          p95: percentile(0.95),
          p99: percentile(0.99),
        });
        console.log(name, `concurrency=${concurrency}`, `errors=${errors}`);
      }
    }
    report = `# Local API performance — synthetic dataset\n\nMeasured ${new Date().toISOString()}. Node ${process.version}; ${os.platform()} ${os.arch()}; ${os.cpus()[0]?.model}; ${os.cpus().length} logical CPUs.\n\n100,000 isolated synthetic payments: 50% Base Sepolia USDC, 50% native BERA; 1% PROCESSING, 99% CONFIRMED; timestamps tied in groups of ten. Synthetic statuses are list fixtures, not verified settlements. Fresh schema; disabled merchant password; ephemeral session still exercises real authorization queries. No worker/RPC or real payment rows involved.\n\nHTTP loopback directly to a separate Nest app on an ephemeral port. Load generator and app share this Node process/event loop; PostgreSQL runs in local Docker shared with the development app. Warm cache, 30 warm-up requests per scenario. Closed-loop bounded concurrency, 500 requests per row. Latency includes response JSON parsing. No TLS, Next proxy, browser rendering, SSE, writes or sustained-production capacity claim. Error responses/timeouts excluded from latency percentiles and counted separately.\n\n| Scenario | Concurrency | Requests | Errors | Seconds | Requests/s | p50 ms | p95 ms | p99 ms |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
    for (const r of results)
      report += `| ${r.name} | ${r.concurrency} | ${r.requests} | ${r.errors} | ${r.seconds.toFixed(2)} | ${r.rps.toFixed(1)} | ${r.p50?.toFixed(2)} | ${r.p95?.toFixed(2)} | ${r.p99?.toFixed(2)} |\n`;
    if (results.some((r) => r.errors)) process.exitCode = 1;
  } finally {
    await app?.close();
    await database?.pool.end();
    await admin.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.pool.end();
  }
  if (report)
    await writeFile(
      resolve(__dirname, '../../../docs/performance-api.md'),
      report + '\nTemporary schema and API were removed after the run.\n',
    );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
