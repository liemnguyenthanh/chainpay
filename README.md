# ChainPay Mini

## Synthetic performance smoke

Run against local PostgreSQL using an explicit benchmark URL. Both commands create a random isolated schema and clean it up; they do not add dummy payments to the normal dashboard or start a blockchain worker.

```bash
BENCHMARK_DATABASE_URL=postgresql://chainpay:chainpay_local@127.0.0.1:15432/chainpay pnpm perf:api
BENCHMARK_DATABASE_URL=postgresql://chainpay:chainpay_local@127.0.0.1:15432/chainpay BENCHMARK_REPORT_PATH=../../docs/performance-db.md pnpm db:benchmark
```

Run sequentially so they do not compete for resources. [API results](docs/performance-api.md) include 100k mixed USDC/BERA fixtures, authorization, bounded concurrent reads, response validation and p50/p95/p99. [Database results](docs/performance-db.md) compare cursor and OFFSET. These short warm-local runs are performance smoke checks, not sustained capacity or production SLAs. The API generator shares the server's Node event loop; TLS, proxy, browser, SSE and chain verification are outside the measurement. An interrupted process may leave its disposable schema; identify it before cleanup.

Native BERA on Berachain mainnet is an explicitly selectable extension; see [configuration and manual flow](docs/berachain.md). Base Sepolia USDC remains the default. Mainnet transfers are signed manually by the user, never by tests.

A deliberately small non-custodial USDC payment portfolio project using React/Next.js, NestJS, PostgreSQL and Redis.

**Current status: Phase 4 merchant dashboard and realtime implemented.** Next.js + wagmi/viem supports injected EOA wallets on Base Sepolia. Checkout authenticates the payer, checks balances, preserves transaction evidence and polls authoritative backend status. PostgreSQL owns settlement; BullMQ/Redis delivers verification work. Real wallet/testnet smoke remains user-run.

## Run locally

Prerequisites: Node.js 22, pnpm 9.15.4, Docker with Compose.

```bash
pnpm install --frozen-lockfile
docker compose -f infra/compose.yaml up -d --wait
# Export DATABASE_URL, REDIS_URL, MERCHANT_ORIGIN and BASE_SEPOLIA_RPC_URL.
# Set a private DEMO_MERCHANT_PASSWORD (16–256 chars) and DEMO_RECEIVER_ADDRESS.
pnpm db:migrate
pnpm db:seed
pnpm dev
```

- Web merchant dashboard/dev: http://localhost:3000; wallet checkout requires **https://localhost:3000** (see below).
- API: http://127.0.0.1:3001/v1/health (process liveness only)
- Worker: consumes verification jobs and scans outbox/due attempts every second.
- PostgreSQL: loopback port 5432, local user/database `chainpay`, password `chainpay_local`.
- Redis: loopback port 6379; AOF and named volume enabled.

Application `.env` auto-loading is not implemented: export environment variables into the shell. `DATABASE_URL` and an exact `MERCHANT_ORIGIN` are required by the API. Demo credentials stay server-side. Seeding is insert-only and repeatable; it does not reset an existing password or receiver. Checkout cookies always require Secure transport. Production mode also requires an HTTPS origin for merchant access.

Stop processes with Ctrl+C. Stop dependencies without deleting data:

If the default database/Redis ports are occupied, start with `POSTGRES_PORT=15432 REDIS_PORT=16379 docker compose -f infra/compose.yaml up -d --wait`. Use matching DATABASE_URL, TEST_DATABASE_URL, REDIS_URL and TEST_REDIS_URL.

```bash
docker compose -f infra/compose.yaml down
```

## Quality checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Install the browser once with `pnpm --filter @chainpay/web exec playwright install chromium` (CI uses `--with-deps`). Set `TEST_DATABASE_URL` and `TEST_REDIS_URL` to run all integration suites with `pnpm test`. Browser E2E requires PostgreSQL and fails clearly without TEST_DATABASE_URL; older backend suites explicitly skip missing services. Tests create/remove random isolated PostgreSQL schemas and Redis queues and require schema creation privileges. CI supplies PostgreSQL and Redis. Test results are not cached. Unit tests cover money boundaries and runtime configuration. Husky runs lint-staged formatting on commit; CI owns broader checks.

## Merchant API

- `POST /v1/merchant/session` with JSON `{ "password": "<private demo password>" }` and the configured `Origin` issues an 8-hour HttpOnly, SameSite=Strict cookie. `GET` checks access and `DELETE` revokes the session.
- `POST /v1/payments` requires that cookie, the configured `Origin`, and an `Idempotency-Key` header (1–128 visible ASCII characters). Body: `{ "amount": "1.25", "token": "USDC", "chainId": 84532 }`. New payment: 201; normalized replay: 200; different normalized input: 409. `1`, `01.0` and `1.000000` normalize identically. Numeric JSON amounts, whitespace, exponent notation, zero, negatives and more than six decimal places are rejected.
- `GET /v1/payments/:id` and `GET /v1/payments?limit=30&cursor=...` require the merchant cookie. Limits are 1–100; use `nextCursor` unchanged. Unknown and other-merchant IDs both return 404.
- Responses expose decimal strings for both human amounts and integer base units. Errors return `code`, safe `message`, and `requestId`; responses disable caching.

Drizzle ORM with `pg` supplies typed, parameterized queries and explicit PostgreSQL conflict handling ([official insert documentation](https://orm.drizzle.team/docs/insert)). Reviewed SQL migrations are authoritative for constraints; the TypeScript schema maps columns. A transactional, advisory-locked migration runner records checksums and rejects edits to applied migrations. Numbered SQL files are discovered in lexical order; existing migrations must not be edited.

The DB enforces the Base Sepolia USDC pair, six decimals, integer uint256 bounds, normalized receiver addresses, merchant/key uniqueness, foreign keys and payment status consistency. Base-unit storage uses unconstrained `numeric` plus integer and range checks so PostgreSQL cannot round fractional input before validation. Payment listing uses `(merchant_id, created_at DESC, id DESC)` with millisecond timestamp precision. Receiver is snapshotted from the seeded merchant. Replays compare normalized caller input, preserving the original snapshot.

## Checkout and verification API

1. Merchant cookie + Origin: `POST /v1/payments/:id/checkout-token` returns `{checkoutToken}`. This rotates only unbound checkouts and invalidates previous challenges; retain the returned token privately. Lost tokens after binding have no rotation/recovery endpoint in this phase.
2. `GET /v1/checkout/:token` returns limited payment terms, version and latest attempt status/reason.
3. Origin: `POST /v1/checkout/:token/challenge` with `{payerAddress}` returns `{challengeId,message,expiresAt}`. Sign the exact message with an EOA, then `POST /v1/checkout/:token/verify` with `{challengeId,signature}`. Challenges expire after five minutes and are consumed once. The one-hour checkout cookie is Secure, HttpOnly, SameSite=Strict and payment scoped; browser use needs HTTPS (local HTTP tests send cookies explicitly).
4. Checkout cookie + Origin: `POST /v1/checkout/:token/transactions` with `{txHash}` returns 202 after committing attempt, PROCESSING state and outbox. Repeated hash returns the same attempt; another active hash returns 409. Confirmed payments return their settlement.
5. Merchant cookie + Origin: `POST /v1/payments/:id/attempts/:attemptId/retry` resumes only NEEDS_REVIEW attempts. There is no public retry endpoint. Recovery verifies the same hash and never requests another transfer.

The payer binding retains its start block across session renewal and never changes payer. One allocation claim per merchant/payer/chain/token/receiver/amount persists until settlement, including expired sessions and rejected attempts. This intentionally blocks abandoned ambiguous claims; explicit reconciliation/unbinding tooling is deferred. Direct ERC-20 transfers contain no invoice ID, so this policy does not prove invoice intent.

The verifier accepts only Base Sepolia USDC direct EOA `transfer` calls with exact calldata and matching receipt/log evidence after the binding block. It checks RPC chain identity, canonical block and rereads receipt/transaction before settlement. `VERIFY_CONFIRMATIONS` defaults to 3, minimum 2. CONFIRMED is terminal for this demo; later reorgs remain a residual risk without post-confirmation reconciliation.

Attempts have a 120-second lease and version fence. RPC timeout/429 retries use exponential backoff with jitter (five technical failures become NEEDS_REVIEW). Unknown receipts stay pending; invalid evidence rejects only that attempt. Database settlement uniqueness prevents a chain/hash from paying two invoices. Outbox delivery can duplicate; due-attempt scans recover jobs lost even after delivery acknowledgement. PAYMENT_UPDATED is published to Redis and forwarded through merchant-scoped SSE. PostgreSQL ownership and the active merchant session are checked before delivery; event payloads are invalidation hints, not settlement evidence.

This is minimal demo access: only the seeded `demo` merchant can log in through the password endpoint. There is no registration, password reset, account management or expired-session cleanup job. Login throttling is bounded and per-process, unsuitable for distributed deployment. Next proxies `/v1` to the server-only `API_INTERNAL_ORIGIN`; browser and API use the same HTTPS origin. CORS remains disabled. Checkout throttling is also per-process. Local HTTPS browser integration is tested with deterministic wallet/RPC fixtures. No live RPC/wallet smoke, deployment, production readiness or mainnet behavior has been verified. Wallet replacement automation, retention/cleanup jobs and operational reconciliation are deferred.

## Browser checkout

Open `/checkout/<checkoutToken>` using the merchant-issued token described above. The public snapshot contains only payment terms, state/version and latest attempt status/reason; it contains no merchant session, signature, payer address or transaction hash.

Use **one HTTPS origin**: `MERCHANT_ORIGIN=https://localhost:3000` and server-only `API_INTERNAL_ORIGIN=http://127.0.0.1:3001`. Start API/worker normally and web with `pnpm --filter @chainpay/web dev:https`. The `/v1` proxy preserves Origin, Set-Cookie and the original cookie path. No CORS wildcard, forwarded-origin substitution or relaxed cookie setting is used. See [manual testnet smoke](docs/testnet-smoke.md) for local certificate setup and payment creation.

The supported network is [Base Sepolia, 84532](https://docs.base.org/base-chain/api-reference/rpc-overview); USDC is [Circle's official test token](https://developers.circle.com/stablecoins/usdc-contract-addresses), `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. Wallet reads use the injected provider; the private backend RPC URL never enters the browser bundle. Fee checks include an approximate conservative L1 allowance; the wallet supplies the actual fee quote.

The send flow refreshes server status, signs the existing payer challenge, checks balances and rechecks status before transfer. A synchronous guard and Web Locks prevent concurrent sends in the same browser/origin. Before wallet broadcast, localStorage records uncertainty; the returned hash is saved before API submission. Reload/network recovery submits the same hash, renewing the scoped session if required. An unknown broadcast blocks sending and asks for wallet-history recovery. Browser storage failure blocks broadcast. A known saved hash is never silently discarded, even if the attempt is rejected; investigate before another transfer.

TanStack Query keeps server status, rejects older versions and preserves terminal confirmation. Polling runs every five seconds in the foreground with a 60-request budget; focus/reconnect share that budget. Manual refresh starts a fresh budget. CONFIRMED and NEEDS_REVIEW stop interval polling; NEEDS_REVIEW remains uncertain, not failed. Checkout retains its existing bounded polling contract. Merchant dashboard uses scoped SSE with HTTP recovery.

Limits: injected EOA wallets only, Web Locks required, local evidence does not coordinate separate devices or survive cleared storage. Use wallet-history recovery if evidence is missing. No automatic replacement/cancellation, post-confirmation reconciliation or production claim. Testnet signing is an explicit user action; no real key or live transfer was used during implementation.

## Merchant dashboard and realtime

Open `/` and sign in with the configured private demo password. Create a payment, copy/open its checkout URL, filter payments by status, navigate bounded cursor pages and inspect payment evidence. The dashboard and checkout share neutral dark semantic tokens and self-hosted licensed Inter fonts. No analytics, totals or placeholder payments are shown.

`GET /v1/payments` additionally accepts `status=AWAITING_PAYMENT|PROCESSING|CONFIRMED`. `GET /v1/payments/:id` adds merchant-only payer, latest attempt and settlement evidence from a consistent database snapshot. `GET /v1/merchant/events` authenticates the same cookie and emits `ready` plus `payment` events containing only `{paymentId,status,version}`. Merchant selectors cannot broaden access. Expired/revoked sessions close before further payment delivery; heartbeat checks run every 15 seconds. `Cache-Control: no-transform` prevents proxy compression buffering, and the client retries failed streams with 1–30s backoff. Redis disconnection closes streams so reconnect triggers HTTP recovery.

The UI ignores duplicate/older versions and refetches affected visible lists rather than inserting events into cursor pages. Every ready/reconnect/focus/online refetch includes empty filters so missed events and filter membership recover. Pending fallback polling runs every five seconds in the foreground with a 60-request budget; manual refresh renews it. SSE is not a durable replay feed. Pagination uses exclusive `(created_at,id)` cursors, default 30 and max 100, with no OFFSET query in the API.

Creation preserves its idempotency key across uncertain retries. Checkout token issuance remains a separate operation; link issuance failure does not create a second payment. Tokens are held in UI memory and can only be explicitly reissued while unbound, preserving the earlier checkout contract.

See [end-to-end demo checklist and delivery plan](docs/phase4-demo.md), [event/API contract](docs/phase4-contracts.md) and [actual 100k synthetic query measurements](docs/phase4-benchmark.md). Run `BENCHMARK_DATABASE_URL=<local-test-db> pnpm db:benchmark` to reproduce the isolated measurement; it ignores the application DATABASE_URL and drops its random schema afterward.

## Project map

See [code organization and responsibility boundaries](docs/code-organization.md) before extending API or frontend features.

```text
apps/web          Next.js UI
apps/api          NestJS HTTP
apps/worker       NestJS BullMQ dispatch, recovery and settlement
packages/config   Runtime environment validation
packages/shared   Verification and queue contracts
packages/database Drizzle schema, SQL migrations and demo seed
packages/blockchain EVM RPC adapter and deterministic fixtures
infra/compose.yaml PostgreSQL + Redis
```

Read [the implementation spec](docs/spec.md), [delivery plan](docs/plan.md), [agent instructions](AGENTS.md) and [next prompts](docs/next-prompts.md). The original guide is retained as background; the spec defines the corrected flow and demo limitations.

## Verification evidence (2026-09-10)

Local PostgreSQL 16 and Redis 7 ran on ports 15432/16379. The populated Phase 1 upgrade test applied migration 0002 and reran migrations without changing prior payment/session data. The complete signed HTTP checkout → submission → outbox → BullMQ worker → RpcVerifier fixture → settlement test passed. Failure coverage includes replay/binding races, wrong signer/domain/chain, invalid transfers, RPC errors/exhaustion, reorgs, duplicate submissions/jobs, stale leases, concurrent global settlement, outbox crash boundaries and delivered jobs lost from Redis. No wallet or funds were needed. CI configuration was updated but has not run remotely.

Executed successfully: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check`, and `TEST_DATABASE_URL=postgresql://chainpay:chainpay_local@127.0.0.1:15432/chainpay TEST_REDIS_URL=redis://127.0.0.1:16379 pnpm test`. The final test run passed **52 tests, zero failures and zero skips** (14 API, 8 worker, 25 blockchain, 1 migration upgrade, 4 config). An earlier run without service variables explicitly skipped integration suites; the final run included them all.

## Phase 3 verification (2026-09-10)

`pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm format:check` and the full service-backed `pnpm test` passed locally: **52 backend/config/database tests + 10 HTTPS Chromium E2E = 62 passed, zero failures/skips**. E2E covers real challenge signatures, cookie scope/security, public data minimization, double-click, wrong chain, rejection, insufficient balances, hash recovery across reload/session expiry, response loss before and after API commit, ambiguous broadcast, storage failure, processing/review/confirmed states, Origin/CORS rejection and bounded polling. Browser confirmation executes the existing verifier/processor against deterministic chain data; the existing backend E2E separately exercises real BullMQ/Redis delivery.

To run browser tests alone after building the workspace:

```bash
TEST_DATABASE_URL=postgresql://chainpay:chainpay_local@127.0.0.1:15432/chainpay TEST_REDIS_URL=redis://127.0.0.1:16379 pnpm --filter @chainpay/web test
```

Tests reserve localhost ports 13100/13101, generate a temporary TLS certificate with OpenSSL and create/drop an isolated PostgreSQL schema. No application-only test bypass exists. Browser certificate verification is relaxed only in Playwright; application cookies and origin checks are unchanged. The user still needs to execute [manual testnet smoke](docs/testnet-smoke.md). No live wallet/RPC, deployment or mainnet transaction was performed.

## Phase 4 verification (2026-09-10)

Workspace lint, typecheck, format check, build and the real-service test run passed: **78 tests, zero failures/skips** (59 backend/config/database + 19 HTTPS Chromium E2E). Explicit test-file paths prevent silent zero-test discovery. Browser assertions verify actual Redis/SSE events through the Next proxy, including initial 503 recovery, old/duplicate events, missed updates, empty filters, initial-fetch races, insertion during cursor pagination, polling limits, idempotent create retry and session revocation. Existing checkout behavior remains covered.

Twenty fixture screenshots at 375px/1440px are in [the evidence gallery](docs/evidence/phase4/README.md). The [100k measurement](docs/phase4-benchmark.md) recorded 0.036ms for a deep compound cursor on local PostgreSQL; this is not a production performance claim. The [MVP demo checklist](docs/phase4-demo.md) separates automated fixtures from the still-unexecuted manual wallet/RPC smoke. No deployment or real transfer was performed.
