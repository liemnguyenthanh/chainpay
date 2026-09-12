# User-run Base Sepolia smoke

This procedure has **not** been executed against a real wallet or live RPC by the implementation agent. Browser E2E uses an ephemeral fixture signer and deterministic RPC responses; it is not evidence of real wallet compatibility or live settlement.

## Network and prerequisites

- Base Sepolia, chain ID **84532**, native gas token **ETH**. Official Base [network/RPC documentation](https://docs.base.org/base-chain/api-reference/rpc-overview); public testnet endpoint `https://sepolia.base.org` is rate limited.
- Circle test USDC: **0x036CbD53842c5426634e7929541eC2318f3dCF7e**, six decimals, from [Circle's official contract list](https://developers.circle.com/stablecoins/usdc-contract-addresses). Obtain test USDC from [Circle's faucet](https://faucet.circle.com/); follow Base's documentation for test ETH.
- An injected browser EOA wallet (for example MetaMask), a receiver you control, test USDC and test ETH. Smart accounts, delegated-code accounts, routers and batches are outside scope.
- Never paste keys or seed phrases into this project. All signing stays in the browser wallet. Do not use mainnet.

## Local HTTPS topology

The browser loads `https://localhost:3000`. Next forwards **the same `/v1/...` path** to `API_INTERNAL_ORIGIN=http://127.0.0.1:3001`. API and worker run privately. `MERCHANT_ORIGIN=https://localhost:3000` must match the browser origin exactly, including port. No cross-origin CORS access is enabled. Do not substitute `127.0.0.1` in the browser URL unless you also configure that exact HTTPS origin and certificate.

Checkout cookies remain `Secure; HttpOnly; SameSite=Strict`, scoped to `/v1/checkout/<token>`. The proxy preserves Set-Cookie and Origin; it does not fabricate Origin or strip security attributes. Missing/foreign Origin writes are rejected by the existing API. Use a locally trusted development certificate; do not disable cookie security to make HTTP work.

Export the environment documented in `.env.example`, setting private demo credentials, your receiver, `BASE_SEPOLIA_RPC_URL` and the exact HTTPS origin. Run dependencies, migrations and seed as described in README. In separate terminals with those exports:

```bash
pnpm --filter @chainpay/api dev
pnpm --filter @chainpay/worker dev
pnpm --filter @chainpay/web dev:https
```

Next's experimental HTTPS command uses a local development certificate. Complete its local certificate setup/trust prompt, or supply your trusted certificate with Next's `--experimental-https-key` and `--experimental-https-cert` flags. Development certificates are ignored by git. HTTPS/browser/wallet trust can vary by machine; automated tests use a temporary self-signed certificate and Chromium's test-only certificate bypass.

## Create the checkout

Use an HTTP client with a cookie jar against the same HTTPS origin and a locally trusted certificate:

1. `POST /v1/merchant/session`, Origin `https://localhost:3000`, JSON `{ "password": "your private demo password" }`.
2. With merchant cookie and Origin, `POST /v1/payments`, header `Idempotency-Key: manual-testnet-001`, JSON `{ "amount": "0.01", "token": "USDC", "chainId": 84532 }`.
3. With merchant cookie and Origin, `POST /v1/payments/<id>/checkout-token`, JSON `{}`. Save the opaque `checkoutToken`; open `https://localhost:3000/checkout/<checkoutToken>`.

Avoid logging or sharing merchant credentials/cookies. The checkout URL grants limited public access to payment terms. There is no merchant dashboard yet. Token rotation is only allowed before binding, as in Phase 2.

## Observe and record

1. Verify amount, network, Circle token address and receiver on the page before connecting. Connect your EOA; test switching from a different chain to Base Sepolia.
2. Authenticate by signing the displayed checkout challenge. It must name the current origin, payment, chain and your payer address. Reject once and confirm that no transfer occurs, then authenticate again.
3. Check balances. Missing USDC or test ETH must block sending. Native fee allowance is conservative (twice estimated execution gas cost plus 0.00001 ETH for L1 data); the wallet provides the actual fee quote, which can change.
4. Send once and inspect the wallet's destination contract and transfer terms before approval. Confirm that hash appears immediately, then PROCESSING, then backend CONFIRMED after configured confirmations. Do not infer settlement from wallet success alone.
5. Reload while processing. The saved hash should remain available and another transfer must be blocked. If submission could not reach the API, use retry submission for the **same hash**. If the session expired, reconnect the **same payer** and sign another challenge; the binding/start block is retained.
6. If the wallet reports an uncertain broadcast without a hash, inspect wallet activity / Base Sepolia explorer, recover that exact hash and submit it. **Do not send again merely because the API/RPC is unavailable.** Replacement/cancellation automation is not implemented.
7. PROCESSING / NEEDS_REVIEW means uncertain verification, not payment failed. NEEDS_REVIEW requires the existing protected merchant retry endpoint after operator investigation. Confirmed checkout must not offer another send.

Local storage keeps only recovery metadata (payment/wallet/hash or uncertainty), never signatures or session tokens. Clearing storage, using another browser/device or private browsing loses that local guard: inspect wallet history before attempting payment. Web Locks coordinate tabs of the same origin only. Browser crash during wallet approval intentionally leaves an uncertainty marker; there is no automatic resend.

Record browser/wallet versions, test transaction hash, status transitions and any errors. No deployment or production-readiness claim follows from this smoke test.
