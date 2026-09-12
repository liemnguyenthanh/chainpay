import type { FormEvent } from 'react';
import { getPaymentAsset, PAYMENT_ASSETS } from '@chainpay/shared';
export function CreatePaymentForm({
  amount,
  setAmount,
  chainId,
  setChainId,
  asset,
  creationLocked,
  busy,
  create,
  setCreating,
}: {
  amount: string;
  setAmount: (value: string) => void;
  chainId: number;
  setChainId: (value: number) => void;
  asset: NonNullable<ReturnType<typeof getPaymentAsset>>;
  creationLocked: boolean;
  busy: boolean;
  create: (event: FormEvent) => void;
  setCreating: (value: boolean) => void;
}) {
  return (
    <section className="panel create-panel" aria-labelledby="create-title">
      <h2 id="create-title">New payment</h2>
      <p className="muted">
        {asset.token} on {asset.name}. The recipient is set by your merchant
        account.{' '}
        {!asset.testnet && 'MAINNET: checkout will transfer real BERA.'}
      </p>
      <form onSubmit={create}>
        <label htmlFor="payment-network">Network / asset</label>
        <select
          id="payment-network"
          value={chainId}
          disabled={busy || creationLocked}
          onChange={(event) => {
            setChainId(Number(event.target.value));
            setAmount('');
          }}
        >
          {PAYMENT_ASSETS.map((option) => (
            <option key={option.chainId} value={option.chainId}>
              {option.name} · {option.token} ·{' '}
              {option.testnet ? 'Testnet' : 'MAINNET (real funds)'}
            </option>
          ))}
        </select>
        <label htmlFor="amount">Amount ({asset.token})</label>
        <input
          id="amount"
          inputMode="decimal"
          placeholder="Enter amount"
          required
          pattern={`[0-9]+(\\.[0-9]{1,${asset.decimals}})?`}
          value={amount}
          disabled={busy || creationLocked}
          onChange={(event) => setAmount(event.target.value)}
        />
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy
              ? 'Creating…'
              : creationLocked
                ? 'Retry payment creation'
                : 'Create payment and link'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || creationLocked}
            onClick={() => setCreating(false)}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
