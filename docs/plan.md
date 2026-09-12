# Delivery plan

Deliver one verifiable slice at a time. Update this checklist with evidence; do not mark placeholder modules as implemented features.

## Phase 0 — Foundation

- [x] Workspace, strict TS, API/worker/web bootstraps, four shared package boundaries.
- [x] ESLint, Prettier, lightweight Husky/lint-staged, CI and dependency lockfile.
- [x] PostgreSQL/Redis Compose, environment example, startup instructions.
- [x] lint, typecheck, format check, tests and build; smoke boots where available.

Verification on 2026-09-10: all seven packages lint/typecheck/build passed; four config tests passed (other packages have no behavioral tests yet). API and production web returned HTTP 200 on temporary ports 13101/13100. Worker stayed alive and shut down via SIGTERM with its lifecycle hook. PostgreSQL and Redis reached healthy status using ports 15432/16379 because the default Redis port was occupied; smoke containers were stopped afterward. CI configuration exists but has not run on GitHub. No payment implementation or mainnet operation was performed.

## Phase 1 — Domain and create payment

- [x] Select ORM, migrations, merchant seed, minimal merchant session.
- [x] Create/detail/list APIs, normalization, unique constraints and concurrent idempotency tests.

Verification on 2026-09-10: Drizzle 0.45.2 + pg 8.23.0 chosen for typed queries with explicit PostgreSQL constraints and conflict handling. Transactional SQL migration and insert-only seed were each run twice against an isolated PostgreSQL 16 schema. HTTP integration tests passed: 20 simultaneous normalized same-key requests yielded exactly one 201, nineteen 200s and one row; conflicting payload race yielded 201/409. Tests also cover invalid amounts, exact uint256 boundary, unsupported chain/token, missing key, unauthorized access, cross-merchant detail/list/create, expiry/revocation, origin rejection, compound pagination with tied timestamps, and direct DB constraint violations. Seven API tests (including five nested integration scenarios) and four config tests passed with zero skips using TEST_DATABASE_URL on local port 15432. Workspace lint, typecheck, test, build and format check passed. CI now supplies PostgreSQL but has not run remotely.

Limitations: no wallet/public checkout endpoint or usable checkout token is issued yet; reserved hashes need a protected token issuance/rotation policy in the checkout phase. No attempts, settlements or asynchronous work are created, so outbox and settlement/transition invariants remain Phase 2 work. Minimal access supports seeded demo login only, an eight-hour hashed opaque session, per-process login throttling and origin checks. Account management, session cleanup and distributed throttling are deferred. Production HTTPS/browser deployment is unverified. Local integration tests explicitly skip without TEST_DATABASE_URL; CI config supplies it. Setup and API contract are documented in README.md.

## Phase 2 — Transaction processing

- [x] Payer challenge/session and constrained allocation policy.
- [x] Attempts, outbox, durable recovery scans, queue and conditional worker transitions.
- [x] Verification fixtures, RPC failure/reorg tests, settlement uniqueness.

Verification on 2026-09-10: additive 0002 migration upgraded a populated Phase 1 schema and reran idempotently without changing payment/session rows. Real PostgreSQL 16/Redis 7 integration runs use isolated schemas/queues on local ports 15432/16379. Signed checkout HTTP → submission → outbox → BullMQ → RpcVerifier with deterministic RPC fixture → settlement passed. Coverage includes signature replay/expiry/domain/chain/payer and binding races, atomic submission rollback, duplicate jobs, concurrent chain/hash settlement uniqueness, stale workers, bounded technical retries, pre-confirmation reorg and recovery of Redis work lost after delivered acknowledgement.

Workspace `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` and `pnpm format:check` passed. Final test run supplied both TEST_DATABASE_URL and TEST_REDIS_URL: 52 tests passed, zero failures/skips (14 API, 8 worker, 25 blockchain, 1 populated migration upgrade, 4 config).

Limits: no live RPC/wallet or browser HTTPS smoke, frontend or deployment. Confirmation policy defaults to 3 blocks (minimum 2); post-confirmation reconciliation is absent. Persistent allocation claims deliberately require future explicit tooling for abandoned checkouts. Checkout cookies always require Secure transport; test HTTP clients explicitly send them. Rate limiting is per-process. Redis payment events exist, but authorized SSE and missed-event UI recovery remain Phase 4. CI includes both services but has not run remotely. See phase2-contracts.md for state/access choices.

## Phase 3 — One-chain checkout

- [x] Apply docs/ui-design.md tokens, Inter typography and Scalar-inspired checkout layout; verify mobile/desktop screenshots.
- [x] Wallet integration, send guards, local hash recovery and status UI.
- [x] Deterministic HTTPS browser E2E with real API/PostgreSQL and fixture blockchain verification.
- [x] User-run testnet smoke instructions prepared in `docs/testnet-smoke.md`.
- [ ] User executes real wallet/testnet smoke (deliberately not claimed as verified).

Verification on 2026-09-10: Next.js App Router checkout at `/checkout/<token>`, wagmi 2 / viem 2 injected EOA wallet integration and TanStack Query server state. Base Sepolia 84532 and Circle USDC were checked against official Base/Circle documentation. Existing Phase 1–2 API, auth and state contracts remain unchanged. Same-origin `/v1` proxy preserves Secure/HttpOnly/Strict payment-scoped cookies and Origin, with no cross-origin CORS enablement.

Ten Playwright Chromium tests passed on local HTTPS: public snapshot minimization and full signature/session → single transfer → PostgreSQL attempt → RpcVerifier fixture/worker confirmation; double-click; wrong-chain switch and wallet rejection; USDC/native gas shortage; API failure before acknowledgement, reload and expired-cookie renewal; lost response after API commit with idempotent resubmission; ambiguous broadcast (including viem alternate-send fallback guard); storage write failure; PROCESSING/NEEDS_REVIEW and terminal CONFIRMED UI; Origin/CSRF/CORS rejection; bounded polling and manual refresh. Browser tests use ephemeral fixture keys, never real wallet secrets. The existing 52 backend/config/database tests also passed with real local PostgreSQL/Redis: **62 tests total, zero failures/skips**. Workspace build, lint, typecheck and formatting passed.

Limits: no live wallet/RPC transfer, deployment or mainnet test. Native balance guard uses a conservative estimate, not an exact Base L1 fee quote. Local recovery/Web Locks cover the same browser/origin; cleared storage and other devices require wallet-history recovery. Injected EOA wallets only. Polling has a 60-request foreground budget at five-second intervals; SSE remains Phase 4. CI now installs Chromium but has not run remotely.

## Phase 4 — Dashboard and delivery

- [x] Reuse the UI design system for compact merchant navigation, payments table and detail states.
- [x] Merchant pagination, scoped SSE and missed-event recovery (checkout TanStack Query shipped in Phase 3).
- [x] 100k synthetic seed separated from real data; measured EXPLAIN ANALYZE.
- [x] English README/demo, deployment plan for AWS or GCP.

Verification on 2026-09-10: merchant login/create/copy/open checkout, bounded status-filtered list and payment detail are implemented at `/`. Shared contracts retain existing auth/checkout/state semantics. Create and notification intent commit together; payment detail uses a repeatable-read snapshot. SSE resolves ownership and active sessions from PostgreSQL, rejects unauthorized/expired access and closes revoked streams. `no-transform` prevents Next compression from buffering events. Browser reconnect uses bounded 1–30s backoff, including an initial HTTP 503.

Final service-backed `pnpm test`: **78 passed, zero failures/skips** (21 API, 8 worker, 25 blockchain, 1 populated migration upgrade, 4 config, 19 HTTPS Chromium E2E). Root lint, typecheck, format check and production build passed. Test scripts now name `test/*.test.cjs` explicitly because automatic discovery reported zero tests in some packages; the final totals include the actual invariant suites. Shared has no separate runtime tests. Existing ten checkout E2E remain green. New cases cover real outbox/Redis/SSE delivery through Next, version dedup/out-of-order events, empty-filter membership, missed events on repeated reconnect/focus, initial-fetch race, pagination with insertion, bounded polling, lost create acknowledgement and revoked browser sessions. Wallet/RPC in browser tests are deterministic fixtures; no application fixture bypass exists.

100,000 synthetic payments were inserted only into a fresh random schema and removed after EXPLAIN ANALYZE/BUFFERS. Measured execution time: first page **0.041ms**, compound cursor after 90,000 rows **0.036ms**, filtered deep cursor **0.030ms**, OFFSET comparison **11.259ms**. These are single local warm-cache measurements with an even status distribution, not production latency claims. Full plans and reproduction command: [phase4-benchmark.md](phase4-benchmark.md).

Screenshots for dashboard/login/error/detail and checkout default/pending/error/confirmed are captured at 375px and 1440px; inspected layouts have no page-level overflow and long evidence hashes wrap. Dark semantic tokens and licensed self-hosted Inter replace the cream/green scaffold. See [evidence gallery](evidence/phase4/README.md) and [demo checklist / proposed AWS delivery](phase4-demo.md).

Remaining limitations: real wallet/live RPC testnet smoke, production proxy/HTTPS smoke and remote CI remain unexecuted. No deploy, mainnet transfer, analytics, production-readiness claim or synthetic rows in the normal application. Checkout continues its existing bounded polling; merchant SSE is an invalidation stream with no durable replay. Checkout URLs are kept in UI memory and existing unbound-only token rotation restrictions remain. Per-process throttling, operational reconciliation and highly skewed filter performance remain documented deployment concerns.

## Phase 5 — Optional extension

- [x] User-requested Berachain mainnet native BERA extension (2026-09-11): exact asset allowlist, additive migration 0003, API normalization/presentation, chain-routed RPC, native receipt/value verifier, wallet send and merchant asset selection. Base Sepolia USDC remains the default.

BERA verification evidence: 77 backend/config/database tests and 22 browser tests passed, zero failures/skips. Includes native exact-value send via injected fixture, insufficient amount-plus-gas and receiver-contract rejection, 18-decimal API boundaries, additive migration and real PostgreSQL native settlement with log_index=-1. Workspace lint/typecheck/build/format passed. Read-only mainnet RPC returned chain ID 80094 and no code for the configured receiver. Local API/worker/web restarted with BERACHAIN_RPC_URL. No real wallet signing or mainnet settlement smoke performed; see berachain.md.

- [ ] Second EVM chain using the same verification path.
- [ ] Explicitly authorized small mainnet smoke; document finality tradeoff.

## Delegation rule

Use up to three bounded agents only when useful. Assign non-overlapping paths, keep the root package/config/lockfile under one integrator, and run combined checks once after integration. Ask agents to report actual checks and limitations; avoid repeated status polling.
