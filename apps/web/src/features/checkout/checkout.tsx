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
        <h1>ChainPay checkout</h1>
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
          disabled={busy}
        >
          Refresh status
        </button>
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
  return (
    <main className="checkout-shell">
      <header className="checkout-header">
        <Link href="/" className="brand">
          ChainPay <span className="brand-suffix">Mini</span>
        </Link>
        <span className="environment">
          {asset?.testnet ? 'Testnet checkout' : 'MAINNET · Real BERA'}
        </span>
      </header>
      <div className="checkout-grid">
        <PaymentTerms snapshot={snapshot} supported={supported} />
        <section className="checkout-card" aria-label="Payment actions">
          <h2>Payment status</h2>
          <p
            className={`checkout-status ${confirmed ? 'is-confirmed' : ''}`}
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
              Server verification is{' '}
              {review ? 'awaiting operator review' : 'in progress'}. Your
              payment is not marked failed. Do not send another transfer.
            </p>
          )}
          {confirmed && (
            <p>
              The backend has confirmed this payment. No further transfer is
              needed.
            </p>
          )}
          {snapshot.attempt && !confirmed && (
            <p className="checkout-muted">
              Attempt: {snapshot.attempt.status}
              {snapshot.attempt.code ? ` (${snapshot.attempt.code})` : ''}
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
          <button
            className="secondary"
            disabled={busy || query.isFetching}
            onClick={() =>
              void run(async () => {
                await refresh();
              })
            }
          >
            Refresh status
          </button>
          {!confirmed && (
            <>
              <hr />
              <p className="checkout-muted">
                {wallet.address ? (
                  <>
                    Wallet <code>{wallet.address}</code>
                  </>
                ) : (
                  'Connect an EOA wallet to continue.'
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
                          ? 'Waiting for wallet / server…'
                          : `Authenticate and pay ${snapshot.token}`}
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
                <div className="checkout-recovery">
                  <h3>Recover your transfer</h3>
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
                </div>
              )}
              {!recovery && processing && (
                <p>
                  Connect the original payer wallet to recover a transaction
                  hash. Contact the merchant if verification needs review.
                </p>
              )}
            </>
          )}
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
        Settlement status comes from the server. Wallet approval and a
        transaction hash are not proof of payment.
      </p>
    </main>
  );
}
