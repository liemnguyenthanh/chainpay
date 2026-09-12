# ChainPay UI direction

## Reference and authority

User-selected reference: https://scalar.com/, inspected on 2026-09-10. This document governs visual decisions for checkout and merchant dashboard. Preserve ChainPay branding and payment-specific content; use the reference's visual language rather than its marketing content or product navigation.

Observed reference: dark neutral shell, thin separators, compact navigation, restrained rounding, white primary actions, Inter typography. Computed body style was background #0f0f0f, text #e7e7e7, Inter/system sans; the inspected main heading was 24px/600. The remaining tokens below are ChainPay choices, not claimed exact Scalar values.

## Tokens

Centralize these as semantic CSS custom properties in the web app. Replace the scaffold's cream/green theme when implementing the frontend.

| Token              | Value   | Use                               |
| ------------------ | ------- | --------------------------------- |
| background         | #0f0f0f | Page canvas                       |
| surface            | #171717 | Panels and controls               |
| surface-hover      | #222222 | Hover and active rows             |
| border             | #303030 | Structural separators             |
| input-border       | #737373 | Interactive control boundaries    |
| foreground         | #e7e7e7 | Primary text                      |
| muted              | #a3a3a3 | Secondary text                    |
| primary            | #f5f5f5 | Primary action surface            |
| primary-foreground | #111111 | Primary action text               |
| focus              | #93c5fd | Visible keyboard ring             |
| success            | #86efac | Confirmed text/icon               |
| warning            | #fcd34d | Delayed verification / attention  |
| danger             | #fca5a5 | Actual errors or rejected attempt |
| info               | #93c5fd | Pending / informational status    |

Start dark-only; no theme-toggle scope until requested. Color does not carry meaning alone: pair status with text and optionally an icon. Confirm contrast on rendered components; subtle structural borders must not be the only way to identify an input.

## Typography and styling

- Inter for UI, including Vietnamese glyph coverage; weights 400, 500, 600. Self-host licensed font files from a reputable package, retain the license and use font-display swap. Avoid build-time font downloads; system sans is the fallback, not an unlabelled substitute for the chosen face.
- Use the existing styling approach, plain CSS/CSS Modules with semantic tokens. Do not add a large component library just to recreate this style.
- Body 14–16px, mobile editable inputs at least 16px; secondary labels 12–13px. Page title 24–28px/600. Checkout amount 36–44px with tabular numerals.
- System monospace for tx hashes and wallet addresses; never monospace all UI text.
- Spacing scale: 4, 8, 12, 16, 24, 32, 48px. Controls 40px high desktop, minimum 44px touch targets on mobile.
- Control radius 6px, panel radius 8–10px, 1px separators. Avoid oversized pill controls, heavy shadows, glass effects and decorative gradients in payment screens.
- Hover/focus transitions 120–180ms, respect reduced motion. Keep payment state changes immediate and accessible.

## Checkout UX

- A focused centered payment panel around 480px wide; no merchant sidebar on customer checkout. Mobile panel fills available width with 16px gutters.
- Header: ChainPay identity and explicit testnet/network indicator.
- Hierarchy: merchant/payee -> exact USDC amount -> network and token -> receiver -> current step -> one primary action.
- Progress labels: Connect wallet, Verify wallet, Send USDC, Confirm payment. Signing the challenge must say it verifies wallet ownership and does not transfer funds.
- Actions follow actual state: Connect wallet, Switch network, Verify wallet, Pay [amount] USDC. After broadcasting, show View transaction / Retry sync when appropriate, not another Pay action.
- Keep full addresses accessible through expand/copy controls. Truncated address text must not be the only available evidence before signing. Show the token contract when users inspect payment details.
- Loading, wallet rejection, insufficient gas, expired session, offline, pending, confirmed and needs-review states need deliberate layouts. Use inline status beside the relevant action, not toast-only critical information.
- NEEDS_REVIEW copy: verification is delayed/needs checking; payment is not proven failed. A rejected attempt does not imply a refund or blockchain reversal.
- Keep implementation jargon such as outbox, RPC retry budget and database state out of customer copy. Use actual explorer URLs from chain config, no fake link/buttons or success states.

## Merchant dashboard UX

- Compact top bar and approximately 220–240px desktop sidebar only for implemented merchant navigation. Collapse navigation on mobile.
- Payments table is the main content: amount, network, readable status, creation time and detail action. Use aligned numeric columns, subtle separators and quiet hover states.
- Create payment is the primary action. Use restrained filters only when supported by the API. No invented revenue totals, charts or placeholder analytics.
- Payment detail shows exact amounts, recipient, payer, tx reference, status and timestamps; surface retry/recovery actions only when supported and authorized.
- Share the same button, input, alert, badge, typography and token rules with checkout. Reuse small components when a real second use appears.

## Definition of done for frontend work

- Check 375px and 1440px layouts in a browser; long hashes, Vietnamese copy and error messages must fit. No page-level horizontal overflow.
- Verify keyboard focus, labels, disabled/busy behavior, contrast and reduced motion; announce important status updates with aria-live.
- Capture and inspect screenshots of default, pending, error and confirmed states using deterministic fixtures. Fixtures must not appear as real payments in the normal application.
- Run relevant lint/typecheck/build and behavioral tests. Do not claim visual QA from compilation alone.
- This is a design contract; adding this document does not mean the current frontend already implements it.
