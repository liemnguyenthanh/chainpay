import { getPaymentAsset, type MerchantPaymentDetail } from '@chainpay/shared';
import { Badge, date, errorText } from './payment-format';
export function PaymentDetail({
  row,
  loading,
  error,
  setSelected,
  busy,
  setBusy,
  links,
  setMessage,
  issueLink,
}: {
  row: MerchantPaymentDetail | undefined;
  loading: boolean;
  error: Error | null;
  setSelected: (value: string | null) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  links: Record<string, string>;
  setMessage: (value: string) => void;
  issueLink: (id: string) => Promise<void>;
}) {
  return (
    <section className="panel payment-detail" aria-labelledby="detail-title">
      <div className="detail-heading">
        <h2 id="detail-title">Payment details</h2>
        <button className="secondary" onClick={() => setSelected(null)}>
          Close details
        </button>
      </div>
      {loading && <p role="status">Loading payment…</p>}
      {error && (
        <p className="alert error" role="alert">
          {errorText(error)}
        </p>
      )}
      {row && (
        <>
          <div className="detail-summary">
            <strong className="detail-amount">
              {row.amount} <span>{row.token}</span>
            </strong>
            <span aria-live="polite" data-testid="detail-status">
              <Badge status={row.status} />
            </span>
          </div>
          {row.attempt?.status === 'NEEDS_REVIEW' && (
            <p className="alert">
              Verification is delayed and needs operator review. This payment
              has not been proven failed. Do not request another transfer.
            </p>
          )}
          <dl className="detail-grid">
            <div>
              <dt>Payment ID</dt>
              <dd>
                <code>{row.id}</code>
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {getPaymentAsset(row.chainId)?.name ?? 'Unknown network'} (
                {row.chainId})
              </dd>
            </div>
            <div>
              <dt>Recipient</dt>
              <dd>
                <code>{row.receiverAddress}</code>
              </dd>
            </div>
            <div>
              <dt>Payer</dt>
              <dd>
                <code>{row.payerAddress ?? 'Not connected yet'}</code>
              </dd>
            </div>
            <div>
              <dt>{row.token === 'BERA' ? 'Asset' : 'Token contract'}</dt>
              <dd>
                <code>
                  {row.token === 'BERA'
                    ? 'Native BERA (no token contract)'
                    : row.tokenAddress}
                </code>
              </dd>
            </div>
            <div>
              <dt>Transaction</dt>
              <dd>
                {row.settlement?.txHash || row.attempt?.txHash ? (
                  <a
                    href={`${getPaymentAsset(row.chainId)?.explorerUrl}/tx/${row.settlement?.txHash ?? row.attempt?.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <code>{row.settlement?.txHash ?? row.attempt?.txHash}</code>{' '}
                    ↗
                  </a>
                ) : (
                  'No transaction submitted'
                )}
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{date(row.createdAt)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{date(row.updatedAt)}</dd>
            </div>
            {row.confirmedAt && (
              <div>
                <dt>Confirmed</dt>
                <dd>{date(row.confirmedAt)}</dd>
              </div>
            )}
            {row.attempt && (
              <div>
                <dt>Verification</dt>
                <dd>
                  {row.attempt.status.replaceAll('_', ' ').toLowerCase()}
                  {row.attempt.code ? ` · ${row.attempt.code}` : ''}
                </dd>
              </div>
            )}
          </dl>
          {links[row.id] ? (
            <div className="link-panel">
              <label htmlFor="checkout-url">Checkout URL</label>
              <input id="checkout-url" readOnly value={links[row.id]} />
              <div className="actions">
                <button
                  className="secondary"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(links[row.id]!)
                      .then(() => setMessage('Checkout URL copied.'))
                      .catch(() =>
                        setMessage(
                          'Clipboard unavailable. Select and copy the Checkout URL field.',
                        ),
                      );
                  }}
                >
                  Copy checkout URL
                </button>
                <a
                  className="button"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open checkout"
                  href={links[row.id]}
                >
                  Open checkout ↗
                </a>
              </div>
            </div>
          ) : (
            row.status === 'AWAITING_PAYMENT' &&
            !row.payerAddress && (
              <div className="link-panel">
                <p className="muted">
                  Issuing a checkout link invalidates any previous link. Links
                  are kept only in this session.
                </p>
                <button
                  disabled={busy}
                  className="secondary"
                  onClick={() => {
                    setBusy(true);
                    void issueLink(row.id)
                      .catch((error) => setMessage(errorText(error)))
                      .finally(() => setBusy(false));
                  }}
                >
                  Issue checkout link
                </button>
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
