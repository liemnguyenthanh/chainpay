# ChainPay Mini — agent instructions

## Purpose and authority

- Build a small React/Node portfolio application with non-custodial USDC and native BERA checkout.
- `docs/spec.md` is the implementation contract; `docs/plan.md` defines delivery order.
- Frontend styling and UX follow `docs/ui-design.md` (user-selected Scalar reference). Read it before UI changes; replace the original cream/green scaffold with the specified neutral dark direction.
- The original vibe-coding guide is background, not a competing implementation spec.
- Explain material tradeoffs briefly. Prefer completing one verifiable task over adding features.

## Architecture

- pnpm + Turborepo; TypeScript strict.
- `apps/web`: Next.js App Router. Wallet/UI code never determines settlement.
- `apps/api`: NestJS HTTP. Validate, authorize, persist, respond quickly.
- `apps/worker`: NestJS standalone process. Blockchain verification and background dispatch.
- `packages/database`, `blockchain`, `shared`, `config`: focused shared boundaries.
- PostgreSQL is authoritative. Redis/BullMQ delivers retryable work, not settlement truth.

## Code organization

- API `src/app.module.ts` composes feature modules; `main.ts`/`http.ts` own bootstrapping. Put business features under `src/modules/<feature>`, shared infrastructure under `src/infrastructure`, and small cross-cutting helpers under `src/common`.
- Nest controllers translate HTTP input/output and delegate use cases. Services own transactions and business workflows. Extract pure normalization/presentation when useful; do not introduce a generic repository/service layer for every table.
- Register database infrastructure once through its exported module, not by listing DatabaseService again in each feature's providers. Cross-feature dependencies use explicit module imports/exports.
- FE `src/app` owns routes, root layout/providers and global styles. `src/features/<feature>` owns API access, types, hooks and view components for that feature. Keep route files thin.
- Separate query/subscription lifecycle and user-action orchestration from JSX. Extract meaningful panels/forms/details with explicit props; do not replace a giant component with a giant untyped props bag or a generic UI framework.
- Use `@/` imports across FE feature boundaries. Promote helpers/components to shared only when there is actual reuse; avoid barrel files and empty folders for appearance.
- Folder names alone do not prove architecture. A reviewer should find the HTTP boundary, transaction owner, state lifecycle and rendering responsibilities independently.
- Refactors preserve endpoints, money/session/settlement invariants and user-visible behavior. Update test imports and verify from a clean build so obsolete generated files cannot mask broken boundaries.

## Commands and checks

- `pnpm dev`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- `pnpm format:check`; use `pnpm format` to apply formatting.
- `docker compose -f infra/compose.yaml up -d` starts local dependencies.
- Run relevant checks after changes; report what actually ran and what remains unverified.
- Tests should exercise invariants, concurrency and failure recovery, not mirror implementation.

## Invariants

- Money crosses JSON boundaries as decimal strings; settlement uses integer base units.
- Same merchant/idempotency key + same normalized input returns the same payment; conflicting input returns 409.
- Invalid transaction attempts do not permanently fail the payment.
- One chain/transaction hash settles at most one payment, enforced by PostgreSQL.
- Hash submission never proves payment; verify canonical receipt, configured token, sender, recipient, amount and eligibility.
- Persist work intent atomically with domain changes (outbox). All consumers tolerate duplicates.
- RPC outages and exhausted retries do not mean unpaid or failed. Never prompt a second transfer merely because verification is unavailable.
- Never collect private keys, seed phrases, or log credentials/signatures/session tokens.

## Working style

- Read existing code before editing. Follow installed library versions and official documentation.
- Keep dependencies justified and abstractions EVM-specific. Do not add infrastructure beyond the spec.
- No custom contract, refunds, bridge, webhook platform, Kafka or Kubernetes.
- Keep mainnet transactions manual and explicitly requested. Default to local/testnet development.
- Do not claim production readiness or benchmark gains without evidence.
- No custom skills required for ordinary implementation. Keep instructions here concise.
- When the user requests parallel agents, assign bounded tasks with distinct file ownership; one integrator owns root tooling and the lockfile. Avoid spawning agents for trivial sequential work.
- Do not commit, push, deploy, or send external messages unless requested. Local reversible setup is fine.
