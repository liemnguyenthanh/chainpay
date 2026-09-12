# Native BERA extension

User-requested extension: direct native BERA payments on Berachain mainnet alongside existing Base Sepolia USDC. No mainnet transaction is executed by development or tests.

Official reference: https://docs.berachain.com/build/getting-started/common-resources (checked 2026-09-11). Chain ID 80094, public RPC https://rpc.berachain.com, explorer https://berascan.com. Native BERA uses 18 decimals. Configure server-only BERACHAIN_RPC_URL for API binding reads and worker verification. Public RPC may rate-limit.

## Representation and verification

- Shared asset allowlist determines chain, symbol, decimals and native/ERC20 kind. Client-supplied token must match the configured asset.
- Native BERA has no token contract. The database uses zero address as an internal asset identifier, never as a destination. Migration 0003 expands exact chain/token/decimal tuples and retains existing Base rows and idempotency fingerprints.
- Native transaction must be direct EOA-to-EOA with empty calldata, exact receiver and integer value, authenticated payer, successful canonical receipt and inclusion after binding. Contracts/delegated accounts and internal transfers are unsupported. A self-transfer is not a useful payment demonstration; use a distinct payer and receiver.
- No Transfer log is expected; evidence stores log_index=-1 as a native-transfer sentinel. Existing ERC20 evidence uses real nonnegative log indexes.
- Retry, reorg checks, conditional settlement and unique(chain_id,tx_hash) remain authoritative. Confirmation counting is a demo policy, not a claim of irreversible finality or mainnet readiness.
- Wallet requires balance for amount plus estimated gas. BERA is both the payment asset and gas asset. Sending still requires the user's wallet approval.

## Manual use after verification

1. Open the local merchant dashboard and select Berachain mainnet / BERA explicitly. Base Sepolia remains the default.
2. Enter a deliberately small amount, verify merchant receiver, then open checkout.
3. Verify the Mainnet label, BERA amount, chain and receiver. Connect a separate EOA holding BERA, sign the wallet-ownership challenge, then review and approve the transfer yourself.
4. Observe backend status and Berascan evidence. Reload to check hash recovery. Do not send again solely because verification is delayed.

Tests use synthetic transactions and never submit mainnet funds. Live RPC reachability alone does not establish wallet or settlement smoke coverage.

## Signing succeeds but no transfer prompt appears

The first wallet prompt authenticates the payer; it is not a transfer. Native self-transfers are rejected. Checkout now displays a receiver/payer conflict and disables payment before authentication when the connected address equals the receiver. An older checkout may already have bound that address: create a new payment and connect a different payer wallet before authentication. Do not reset or reassign an existing binding silently. Regression coverage checks that the conflict triggers neither a signature nor a send request.
