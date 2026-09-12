import type { Dispatch, SetStateAction } from 'react';
import { getPaymentAsset, type PaymentPage } from '@chainpay/shared';
import { Badge, date, errorText, labels } from './payment-format';
export function PaymentList({
  page,
  loading,
  fetching,
  error,
  filter,
  setFilter,
  limit,
  setLimit,
  cursors,
  setCursors,
  streamState,
  pollPaused,
  refreshPayments,
  onSelect,
}: {
  page: PaymentPage | undefined;
  loading: boolean;
  fetching: boolean;
  error: Error | null;
  filter: string;
  setFilter: (value: string) => void;
  limit: number;
  setLimit: (value: number) => void;
  cursors: (string | null)[];
  setCursors: Dispatch<SetStateAction<(string | null)[]>>;
  streamState: string;
  pollPaused: boolean;
  refreshPayments: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="panel payment-list" aria-label="Payment list">
      <div className="table-toolbar">
        <div className="filters">
          <label>
            Status filter
            <select
              aria-label="Status filter"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setCursors([null]);
              }}
            >
              <option value="">All statuses</option>
              {Object.entries(labels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Page size
            <select
              aria-label="Page size"
              value={limit}
              onChange={(event) => {
                setLimit(Number(event.target.value));
                setCursors([null]);
              }}
            >
              <option>10</option>
              <option>30</option>
              <option>100</option>
            </select>
          </label>
        </div>
        <div className="refresh-tools">
          <span className="stream-state" role="status">
            {streamState}
          </span>
          <button
            className="secondary"
            disabled={fetching}
            onClick={refreshPayments}
          >
            Refresh payments
          </button>
        </div>
      </div>
      {pollPaused && (
        <p className="alert">
          Automatic polling paused. Refresh payments to continue checking. A
          delayed update does not mean a payment failed.
        </p>
      )}
      {error && (
        <p className="alert error" role="alert">
          {errorText(error)}
        </p>
      )}
      {loading ? (
        <p className="empty-state" role="status">
          Loading payments…
        </p>
      ) : !page?.data.length ? (
        <div className="empty-state">
          <h2>No payments {filter ? 'in this status' : 'yet'}.</h2>
          <p className="muted">
            {filter
              ? 'Try another status or refresh for new updates.'
              : 'Create your first payment to share a checkout.'}
          </p>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Payment / created</th>
              <th className="numeric">Amount</th>
              <th>Network</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {page.data.map((payment) => (
              <tr
                key={payment.id}
                data-payment-id={payment.id}
                data-testid={`payment-row-${payment.id}`}
              >
                <td>
                  <code className="payment-id">{payment.id.slice(0, 8)}</code>
                  <time dateTime={payment.createdAt}>
                    {date(payment.createdAt)}
                  </time>
                </td>
                <td className="numeric">
                  <strong>{payment.amount}</strong>
                  <span className="cell-secondary">{payment.token}</span>
                </td>
                <td className="network-cell">
                  {getPaymentAsset(payment.chainId)?.name ?? payment.chainId}
                </td>
                <td>
                  <Badge status={payment.status} />
                </td>
                <td>
                  <button
                    className="secondary detail-button"
                    aria-label={`View payment ${payment.id}`}
                    onClick={() => {
                      onSelect(payment.id);
                    }}
                  >
                    View <span aria-hidden="true">↗</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="pagination">
        <span className="muted">
          Page {cursors.length} · Up to {limit} payments
        </span>
        <div className="actions">
          <button
            className="secondary"
            disabled={cursors.length === 1 || fetching}
            onClick={() => setCursors((previous) => previous.slice(0, -1))}
          >
            Previous page
          </button>
          <button
            className="secondary"
            disabled={!page?.nextCursor || fetching}
            onClick={() =>
              setCursors((previous) => [...previous, page!.nextCursor])
            }
          >
            Next page
          </button>
        </div>
      </div>
    </section>
  );
}
