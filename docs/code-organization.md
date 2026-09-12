# Code organization

This application uses feature-oriented organization. Its boundaries separate HTTP, business workflows, infrastructure, client state and rendering. Folder depth is not a goal: do not add interfaces, repositories or shared components without an actual need.

## API

```text
apps/api/src/
  main.ts / http.ts / app.module.ts
  common/
    crypto/        hashing
    http/          safe errors
    validation/    shared ID validation
  infrastructure/database/
  modules/
    health/
    merchant-session/
    payments/      controller, service, normalization, presenter
    checkout/      payer challenge/session and public checkout
    transactions/  submission and protected recovery
    merchant-events/  scoped SSE delivery
```

`main.ts` starts Nest; `http.ts` configures common HTTP behavior; `app.module.ts` composes feature modules. Each feature owns its controllers, services and domain-specific helpers. Database infrastructure exports its provider through one module so feature modules reuse the same Nest-managed pool and shutdown lifecycle.

Controllers translate requests and responses and enforce HTTP access boundaries. Services own business transactions and persistence workflows. Payment creation commits the payment and outbox together in the service; splitting files must never split that transaction. Pure normalization and serialization do not need injectable classes.

Cross-feature access is explicit through Nest module imports/exports. Common helpers contain only cross-cutting behavior such as errors and hashing, not miscellaneous payment logic. The queue worker remains a separate application.

## Frontend

```text
apps/web/src/
  app/
    layout.tsx / providers.tsx / globals.css
    page.tsx
    checkout/[token]/page.tsx
  features/
    checkout/
      components/
      hooks/
      api.ts / contracts.ts / recovery.ts / wallet.tsx
    dashboard/
      components/
      hooks/
      api.ts / realtime.ts
```

`src/app` contains Next routes, layouts, global styles and provider composition. Routes delegate to feature screens. `src/features` contains checkout and merchant dashboard code, with API functions, typed models, focused hooks and components colocated with their feature.

Views own layout and interaction bindings; hooks own state lifecycles such as queries, subscriptions, creation retries and transfer recovery. Wallet operations retain their safety checks inside the checkout feature. Do not move recovery guards into purely visual components or simplify version-aware cache handling during styling work.

Share a component only when multiple features use the same behavior. Avoid a catch-all `utils` folder, wildcard barrel exports and generic form/table frameworks for two screens. Internal feature files may import each other directly; application routes use the configured `@/` alias.

## Reviewing a change

Find the route/controller first, then the workflow/service or hook, then its persistence/API boundary and tests. If one component mixes subscriptions, state transitions, request retries and hundreds of lines of JSX, extract the responsibilities before adding another feature. Keep module imports acyclic and register infrastructure providers once.

Refactoring must preserve endpoint paths, session checks, transaction boundaries, wallet send guards and observable UI behavior. Compile API from a clean `dist` directory to catch obsolete import paths. Existing PostgreSQL/Redis integration tests and browser E2E exercise the refactored implementation; do not leave compatibility files merely to keep old test imports green.
