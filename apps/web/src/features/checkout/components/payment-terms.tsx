import { formatUnits } from 'viem';
import { getPaymentAsset } from '@chainpay/shared';
import type { CheckoutSnapshot } from '../contracts';
export function PaymentTerms({
  snapshot,
  supported,
}: {
  snapshot: CheckoutSnapshot;
  supported: boolean;
}) {
  const asset = getPaymentAsset(snapshot.chainId);
  return (
    <section className="checkout-card">
      <p className="eyebrow">DIRECT WALLET PAYMENT</p>
      <h1>
        {formatUnits(BigInt(snapshot.amountBaseUnits), snapshot.tokenDecimals)}{' '}
        <span>{snapshot.token}</span>
      </h1>
      <p className="checkout-muted">
        Review the destination and network before approving in your wallet.
      </p>
      <dl className="checkout-details">
        <dt>Network</dt>
        <dd>
          {supported && asset ? asset.name : 'Unsupported network'} ·{' '}
          {snapshot.chainId}
        </dd>
        <dt>{asset?.kind === 'native' ? 'Asset' : 'Token contract'}</dt>
        <dd>
          <code>
            {asset?.kind === 'native'
              ? 'Native BERA (no token contract)'
              : snapshot.tokenAddress}
          </code>
        </dd>
        <dt>Receiver</dt>
        <dd>
          <code>{snapshot.receiverAddress}</code>
        </dd>
        <dt>Payment ID</dt>
        <dd>
          <code>{snapshot.id}</code>
        </dd>
      </dl>
      <p className="checkout-note">
        {snapshot.token} is transferred directly to the receiver. This checkout
        never holds your funds.{' '}
        {asset?.testnet
          ? 'Testnet tokens have no monetary value.'
          : 'Berachain MAINNET: this sends real BERA and spends real network fees. Review the exact amount and receiver before signing.'}
      </p>
    </section>
  );
}
