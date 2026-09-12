# Prompts to continue building

Use these in order, one completed and reviewed slice per task. The implementation spec takes precedence over the original guide.

## 1 — Payment domain

Read AGENTS.md, docs/spec.md and docs/plan.md. Implement Phase 1: choose and briefly justify one PostgreSQL ORM, add migrations and a demo merchant seed, minimal merchant session access, POST payment with normalized money and idempotency, and merchant-scoped detail/list endpoints. Enforce invariants in the DB. Test 20 concurrent identical keys, conflicting payloads, invalid amounts and unauthorized access. Do not add wallet integration yet. Run relevant checks, update the plan with evidence and explain remaining limitations.

## 2 — Reliable verification backend

Read the spec and existing domain. Implement Phase 2 in small steps: payer challenge/session and allocation guard first, then transaction attempts, atomic outbox, BullMQ dispatch, durable pending-work recovery and the verification worker. Use deterministic chain fixtures in tests. Demonstrate duplicate jobs, stale workers, crash windows, Redis job loss, incorrect Transfer logs, reorgs and RPC exhaustion. Keep technical uncertainty distinct from rejection. Do not send real funds. Finish one runnable slice before proceeding to the next; report any unresolved product-policy decisions.

## 3 — Checkout

Read docs/ui-design.md before implementation. Apply the Scalar-inspired dark neutral theme, Inter typography, thin borders and white primary actions. Centralize tokens and replace the old scaffold styling. Keep checkout focused on payment, without a dashboard sidebar. Verify responsive screenshots at 375px and 1440px for default/pending/error/confirmed states. If Phase 3 is already underway, incorporate this as a UI requirement while preserving its existing API/auth integration.

Implement Phase 3 against the existing APIs using wagmi/viem on one explicitly configured testnet. Include payer signing, chain switch, exact amount/receiver display, send guards, local txHash recovery and honest pending/error states. Obtain token addresses only from verified official sources. Add a deterministic E2E and instructions for a manual wallet smoke. Do not execute mainnet transfers or add another chain.

## 4 — Dashboard and realtime

Follow docs/ui-design.md and reuse the checkout tokens/components. Use compact merchant navigation and a restrained payments table; avoid invented analytics. Verify mobile and desktop layouts and long transaction identifiers in-browser.

Implement Phase 4 dashboard features: TanStack Query, bounded compound-cursor pagination, scoped SSE via Redis Pub/Sub, version-aware updates, reconnect/focus/pending resync, and correct filtered-list membership. Add a clearly isolated synthetic 100k seed and measure the relevant PostgreSQL query with EXPLAIN ANALYZE. Do not claim benchmark results if the DB cannot run. Update English README with actual behavior and checks; propose cloud deployment separately.

## Review after each slice

Review the current diff as a senior Fullstack/Web3 engineer. Do not rewrite first. Identify concrete correctness, security, concurrency and recovery failures; cite files and reproduction scenarios. Fix confirmed issues within scope, then run appropriate checks. Explain the three decisions I must understand to defend this slice in an interview. Do not add speculative infrastructure.
