# Phase 4 demo and delivery notes

## Local MVP checklist

1. Install Node 22, pnpm 9.15.4, Docker, then `pnpm install --frozen-lockfile`.
2. Start `docker compose -f infra/compose.yaml up -d --wait`. Export environment variables from `.env.example` with your private demo password, receiver address and testnet RPC URL. The application does not load `.env` automatically.
3. Run `pnpm db:migrate` and `pnpm db:seed`. Keep the password out of frontend environment variables. Seed is insert-only; it does not reset an existing merchant.
4. Use one HTTPS origin: `MERCHANT_ORIGIN=https://localhost:3000`, `API_INTERNAL_ORIGIN=http://127.0.0.1:3001`. Run API and worker (`pnpm --filter @chainpay/api dev`, `pnpm --filter @chainpay/worker dev`) and web (`pnpm --filter @chainpay/web dev:https`). Follow `docs/testnet-smoke.md` for trusted local HTTPS setup.
5. Open the web root, sign in, create a positive USDC amount and copy/open the checkout link. Token issuance uses the existing endpoint. Links remain only in UI memory; issuing another link explicitly invalidates the old unbound checkout. Bound checkout tokens cannot be rotated.
6. For a deterministic automated demo without a wallet or funds, run the browser E2E command below. The runner starts a separate real API with isolated PostgreSQL data and fixture wallet/RPC, and exercises real Redis/outbox notification delivery. Normal application pages have no fixture switch or synthetic payments.
7. For a manual wallet demo, follow the separate testnet smoke guide: review network/token/recipient/amount, connect an EOA, authenticate, approve the test USDC transfer, then observe PROCESSING and CONFIRMED in the dashboard. This manual wallet/RPC step has **not** been performed by the agent. Never treat delayed verification as proof of failure or request a second transfer.
8. Inspect payment details, status filters, pagination and refresh. Disconnect/reconnect the browser to demonstrate recovery. Sign out when finished.

## Deterministic browser evidence

```bash
pnpm build
TEST_DATABASE_URL=postgresql://chainpay:chainpay_local@127.0.0.1:15432/chainpay \
TEST_REDIS_URL=redis://127.0.0.1:16379 \
pnpm --filter @chainpay/web test
```

The harness creates a random `browser_*` schema, migrates/seeds it, and drops it afterward. Ephemeral fixture wallet keys never hold funds. The happy path signs the actual challenge and invokes the existing verification processor with deterministic RPC evidence. Outbox dispatch and Redis/SSE are real. Event-loss/filter tests also use explicitly synthetic state transitions and a browser EventSource fixture; those tests establish UI recovery, not blockchain settlement correctness. No test bypass is imported into the application.

Screenshots under `docs/evidence/phase4/` capture login, error, dashboard, pending, confirmed and detail at 375px/1440px, plus checkout pending/confirmed. They contain isolated fixture data only. Browser assertions also check page overflow. CI configuration exists; remote CI execution is not claimed.

## Synthetic database measurement

```bash
BENCHMARK_DATABASE_URL=postgresql://chainpay:chainpay_local@127.0.0.1:15432/chainpay pnpm db:benchmark
```

This command deliberately ignores `DATABASE_URL`. It always creates a fresh random `benchmark_*` schema and forces its search path before migrating/seeding exactly 100,000 rows. The synthetic merchant has a disabled password, and no application credentials or payment data are copied. Cleanup drops only that random schema in `finally`. A killed process may leave its disposable schema; inspect the name before manually removing it. Never point the normal API/worker at a benchmark schema.

See `phase4-benchmark.md` for actual EXPLAIN ANALYZE/BUFFERS output. The existing merchant/created_at/id index serves compound pagination; the measured filter distribution is even. A highly skewed status filter can scan more rows; these local cache measurements do not establish production latency or throughput. No extra index is justified solely by these measurements.

## Proposed AWS delivery (not executed)

Use a single HTTPS origin behind an Application Load Balancer with `/v1` routed to the API and other paths to Next.js. Run web, API and worker as separate ECS services; use managed PostgreSQL and Redis in private subnets. Supply secrets through the platform's secret store, not public Next environment variables. Preserve Origin and cookies, disable SSE response buffering, and set proxy idle timeout above the 15-second heartbeat. Run reviewed migrations as a separate release step before deploying compatible application versions.

Before any deployment: validate HTTPS/cookie/SSE behavior through the actual proxy; configure backups and restore checks, least-privilege database access, log redaction, RPC provider budgets, operational review/recovery procedures and retention. Login/challenge throttles are per process; distributed access control/rate limiting and connection budgets require deployment-specific work. Redis Pub/Sub has no replay; readiness/focus refetch and bounded pending polling remain necessary. Do not label this demo production-ready. No deployment, cloud resource creation or mainnet operation is authorized by this phase.
