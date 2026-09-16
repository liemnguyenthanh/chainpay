'use client';
import Link from 'next/link';
import { formatUnits, type Hash } from 'viem';
import { getPaymentAsset } from '@chainpay/shared';
import { saveRecovery, type RecoveryRecord } from './recovery';
import { useCheckoutQuery } from './hooks/use-checkout-query';
import { useCheckoutActions } from './hooks/use-checkout-actions';
import { PaymentTerms } from './components/payment-terms';
import './checkout.css';
export function CheckoutPage({ token }: { token: string }) {
  const { query, pollingPaused, refresh } = useCheckoutQuery(token);
  const snapshot = query.data;
  const {
    wallet,
    busy,
    phase,
    message,
    recovery,
    storageReady,
    historyHash,
    setHistoryHash,
    balance,
    walletKey,
    rememberBalance,
    run,
    submit,
    send,
    setRecovery,
  } = useCheckoutActions(token, snapshot, refresh);
  if (!snapshot)
    return (
      <main className="checkout-shell">
        <section className="checkout-card checkout-unavailable">
          <p className="eyebrow">CHAINPAY CHECKOUT</p>
          <h1>
            {query.isPending
              ? 'Getting your payment ready'
              : 'Unable to load payment'}
          </h1>
          <p role="status">
            {query.isPending ? 'Loading checkout…' : 'Checkout is unavailable.'}
          </p>
          {query.error && <p role="alert">{query.error.message}</p>}
          <button
            onClick={() =>
              void run(async () => {
                await refresh();
              })
            }
            disabled={busy || query.isFetching}
          >
            Refresh status
          </button>
        </section>
      </main>
    );
  const confirmed = snapshot.status === 'CONFIRMED';
  const processing = snapshot.status === 'PROCESSING';
  const review = snapshot.attempt?.status === 'NEEDS_REVIEW';
  const asset = getPaymentAsset(snapshot.chainId);
  const selfTransfer =
    asset?.kind === 'native' &&
    wallet.address?.toLowerCase() === snapshot.receiverAddress.toLowerCase();
  const supported =
    !!asset &&
    asset.token === snapshot.token &&
    asset.decimals === snapshot.tokenDecimals &&
    asset.tokenAddress.toLowerCase() === snapshot.tokenAddress.toLowerCase();
  const currentStep = confirmed
    ? 4
    : processing || recovery?.hash || phase === 'confirm'
      ? 3
      : phase === 'send' || !!recovery
        ? 2
        : wallet.connected
          ? 1
          : 0;
  return (
    <main className="checkout-shell">
      <header className="checkout-header">
        <Link href="/" className="brand">
          ChainPay <span className="brand-suffix">Mini</span>
        </Link>
        <span className="environment">
          {!asset
            ? 'Unsupported network'
            : asset.testnet
              ? 'Testnet checkout'
              : 'MAINNET · Real BERA'}
        </span>
      </header>
      <ol className="checkout-steps" aria-label="Payment progress">
        {[
          'Connect wallet',
          'Verify wallet',
          `Send ${snapshot.token}`,
          'Confirm payment',
        ].map((label, index) => (
          <li
            key={label}
            aria-current={index === currentStep ? 'step' : undefined}
            className={index < currentStep ? 'is-complete' : ''}
          >
            <span aria-hidden="true">
              {index < currentStep ? '✓' : index + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
      <div className="checkout-grid">
        <PaymentTerms snapshot={snapshot} supported={supported} />
        <section className="checkout-card" aria-label="Payment actions">
          <h2>
            {confirmed
              ? 'You’re all set'
              : processing
                ? 'Confirming your payment'
                : recovery
                  ? 'Continue your payment'
                  : 'Complete your payment'}
          </h2>
          <p
            className={`checkout-status ${confirmed ? 'is-confirmed' : review ? 'is-review' : ''}`}
            role="status"
          >
            {confirmed
              ? 'Payment confirmed'
              : review
                ? 'Verification needs review'
                : processing
                  ? 'Payment processing'
                  : 'Awaiting payment'}
          </p>
          {(processing || review) && (
            <p>
              {review
                ? 'Verification is taking longer than expected. Contact the merchant if you need help.'
                : 'Your transaction is being checked on the network. You can leave this page and return using the same link.'}{' '}
              Do not send another transfer.
            </p>
          )}
          {confirmed && (
            <p>
              Your payment has been confirmed. No further transfer is needed.
            </p>
          )}
          {snapshot.attempt?.status === 'REJECTED' && !confirmed && (
            <p className="checkout-note">
              The previous transaction did not match this payment. Check its
              details in your wallet before trying again. Funds already sent are
              not automatically returned.
            </p>
          )}
          {query.error && (
            <p role="alert">
              Status temporarily unavailable. Last known status is shown; do not
              infer failure.
            </p>
          )}
          {pollingPaused && (
            <p>Automatic status checks paused. Refresh to check again.</p>
          )}
          {!confirmed && (
            <details
              className="checkout-wallet-panel"
              open={!processing || !!recovery}
            >
              <summary hidden={!processing}>
                Need to recover a transfer?
              </summary>
              <p className="checkout-muted">
                {wallet.address ? (
                  <>
                    Wallet <code>{wallet.address}</code>
                  </>
                ) : processing ? (
                  'Connect the original payer wallet only if you need to recover a transaction.'
                ) : (
                  'Connect your wallet to pay directly to the receiver.'
                )}
              </p>
              {!wallet.connected ? (
                <button
                  disabled={busy}
                  onClick={() => void run(wallet.connect)}
                >
                  Connect wallet
                </button>
              ) : wallet.chainId !== snapshot.chainId ? (
                <button
                  disabled={busy || !supported}
                  onClick={() =>
                    void run(() => wallet.switchChain(snapshot.chainId))
                  }
                >
                  Switch to {asset?.name}
                </button>
              ) : (
                <>
                  {!processing && !recovery && (
                    <>
                      {selfTransfer && (
                        <p role="alert" className="checkout-note">
                          This wallet is the receiver. Use a different payer
                          wallet. If already authenticated, create a new payment
                          for the different wallet.
                        </p>
                      )}
                      <p className="checkout-muted">
                        First, sign a message to verify wallet ownership — this
                        does not transfer funds. Then review and approve the
                        payment in your wallet.
                      </p>
                      <button
                        disabled={
                          busy ||
                          !storageReady ||
                          !supported ||
                          !!query.error ||
                          selfTransfer
                        }
                        onClick={() => void run(send)}
                      >
                        {busy
                          ? phase === 'verify'
                            ? 'Verify ownership in your wallet…'
                            : phase === 'send'
                              ? 'Approve payment in your wallet…'
                              : 'Checking payment…'
                          : `Pay ${formatUnits(BigInt(snapshot.amountBaseUnits), snapshot.tokenDecimals)} ${snapshot.token}`}
                      </button>
                    </>
                  )}
                  <button
                    className="secondary"
                    disabled={busy || !supported}
                    onClick={() =>
                      void run(async () => {
                        const funds = await wallet.checkBalance(snapshot);
                        rememberBalance(
                          `${formatUnits(funds.assetBalance, snapshot.tokenDecimals)} ${snapshot.token} · ${formatUnits(funds.native, 18)} ${asset?.nativeSymbol}`,
                        );
                        if (
                          funds.assetBalance < BigInt(snapshot.amountBaseUnits)
                        )
                          throw new Error(
                            'Insufficient payment asset balance.',
                          );
                        if (
                          funds.native < funds.requiredNative ||
                          funds.native === 0n
                        )
                          throw new Error(
                            'Insufficient native balance for payment and gas.',
                          );
                      })
                    }
                  >
                    Check balances
                  </button>
                </>
              )}
              {balance?.wallet === walletKey && (
                <p aria-label="Wallet balances">{balance.value}</p>
              )}
              {(recovery || wallet.connected) && (
                <details
                  className="checkout-recovery"
                  open={recovery || processing ? true : undefined}
                >
                  <summary>
                    {recovery || processing
                      ? 'Recover your transfer'
                      : 'Already paid? Recover a transfer'}
                  </summary>
                  <p>
                    {recovery?.hash
                      ? 'Transaction hash saved. Retry submits this same hash only; it never sends funds again.'
                      : recovery
                        ? 'A transfer may have been broadcast. Check wallet history and copy its hash. Do not send again.'
                        : 'Already sent a transfer, or using a new browser? Recover its hash from wallet history instead of sending again.'}
                  </p>
                  {recovery?.hash ? (
                    <>
                      <code data-testid="saved-hash">{recovery.hash}</code>
                      {asset && (
                        <a
                          href={`${asset.explorerUrl}/tx/${recovery.hash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View on explorer ↗
                        </a>
                      )}
                      <button
                        disabled={busy || !wallet.connected}
                        onClick={() =>
                          void run(async () => {
                            await submit(recovery);
                          })
                        }
                      >
                        Submit saved transaction
                      </button>
                    </>
                  ) : (
                    <>
                      <label htmlFor="history-hash">
                        Transaction hash from wallet history
                      </label>
                      <input
                        id="history-hash"
                        autoComplete="off"
                        spellCheck={false}
                        value={historyHash}
                        onChange={(event) => setHistoryHash(event.target.value)}
                      />
                      <button
                        disabled={
                          busy ||
                          !/^0x[0-9a-fA-F]{64}$/.test(historyHash) ||
                          !wallet.connected
                        }
                        onClick={() =>
                          void run(async () => {
                            if (!wallet.address)
                              throw new Error(
                                'Connect the original payer wallet.',
                              );
                            const record: RecoveryRecord = {
                              paymentId: snapshot.id,
                              payer: wallet.address,
                              ...recovery,
                              hash: historyHash as Hash,
                            };
                            saveRecovery(record);
                            setRecovery(record);
                            await submit(record);
                          })
                        }
                      >
                        Save and submit recovered hash
                      </button>
                    </>
                  )}
                </details>
              )}
              {!recovery && processing && (
                <p>
                  Connect the original payer wallet to recover a transaction
                  hash. Contact the merchant if verification needs review.
                </p>
              )}
            </details>
          )}
          <button
            className="secondary checkout-refresh"
            disabled={busy || query.isFetching}
            onClick={() =>
              void run(async () => {
                await refresh();
              })
            }
          >
            Refresh status
          </button>
          {message && (
            <p className="checkout-message" role="alert">
              {message}
            </p>
          )}
          {!supported && (
            <p role="alert">Unsupported checkout network or asset.</p>
          )}
        </section>
      </div>
      <p className="checkout-footer">
        Payments go directly to the receiver. ChainPay never holds your funds. A
        transaction is complete only when this page shows Payment confirmed.
      </p>
    </main>
  );
}
