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
    <section
      className="checkout-card checkout-summary"
      aria-label="Payment details"
    >
      <p className="eyebrow">DIRECT WALLET PAYMENT</p>
      <h1>
        {formatUnits(BigInt(snapshot.amountBaseUnits), snapshot.tokenDecimals)}{' '}
        <span>{snapshot.token}</span>
      </h1>
      <p className="checkout-network">
        {supported && asset ? asset.name : 'Unsupported network'}
      </p>
      <dl className="checkout-details checkout-recipient">
        <dt>Pay to</dt>
        <dd>
          <code>{snapshot.receiverAddress}</code>
        </dd>
      </dl>
      <details className="checkout-disclosure">
        <summary>Payment details</summary>
        <dl className="checkout-details">
          <dt>Network ID</dt>
          <dd>{snapshot.chainId}</dd>
          <dt>{asset?.kind === 'native' ? 'Asset' : 'Token contract'}</dt>
          <dd>
            <code>
              {asset?.kind === 'native'
                ? 'Native BERA (no token contract)'
                : snapshot.tokenAddress}
            </code>
          </dd>
          <dt>Payment ID</dt>
          <dd>
            <code>{snapshot.id}</code>
          </dd>
        </dl>
      </details>
      <p
        className={`checkout-note ${asset && !asset.testnet ? 'checkout-mainnet' : ''}`}
      >
        {asset?.testnet
          ? 'Testnet payment · Use test tokens only. You also need ETH for network fees.'
          : asset
            ? 'Real funds · This payment sends BERA on Berachain mainnet. Network fees are added by your wallet.'
            : 'This network is not supported. Check the payment link with the merchant.'}
      </p>
    </section>
  );
}
