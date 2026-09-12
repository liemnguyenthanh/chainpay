'use client';
import Link from 'next/link';
import { CreatePaymentForm } from './create-payment-form';
import { PaymentList } from './payment-list';
import { PaymentDetail } from './payment-detail';
import { Brand, type Merchant } from './payment-format';
import { usePaymentQueries } from '../hooks/use-payment-queries';
import { usePaymentActions } from '../hooks/use-payment-actions';
export function Workspace({ merchant }: { merchant: Merchant }) {
  const {
    query,
    detail,
    filter,
    setFilter,
    limit,
    setLimit,
    cursors,
    setCursors,
    selected,
    setSelected,
    pollPaused,
    streamState,
    refreshPayments,
  } = usePaymentQueries(merchant);
  const {
    creating,
    setCreating,
    amount,
    setAmount,
    chainId,
    setChainId,
    asset,
    creationLocked,
    busy,
    setBusy,
    message,
    setMessage,
    links,
    issueLink,
    create,
    logout,
  } = usePaymentActions(merchant.id, (id) => {
    setSelected(id);
    setCursors([null]);
    setFilter('');
  });
  const row = detail.data;
  return (
    <div className="workspace">
      <header className="topbar">
        <Brand />
        <span className="environment">USDC Testnet / BERA Mainnet</span>
      </header>
      <aside className="sidebar">
        <p className="eyebrow">WORKSPACE</p>
        <Link href="/" aria-current="page" className="nav-current">
          ▤ <span>Payments</span>
        </Link>
        <div className="sidebar-bottom">
          <span className="muted">{merchant.name}</span>
          <button
            className="secondary"
            onClick={() => void logout()}
            disabled={busy}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="dashboard-main">
        <div className="page-heading">
          <div>
            <p className="eyebrow">MERCHANT / PAYMENTS</p>
            <h1>Payments</h1>
            <p className="muted">
              Create a checkout. Follow every confirmation.
            </p>
          </div>
          <button
            onClick={() => {
              setCreating(true);
              setMessage('');
            }}
            disabled={busy}
          >
            Create payment <span aria-hidden="true">＋</span>
          </button>
        </div>
        {message && (
          <p role="alert" className="alert">
            {message}
          </p>
        )}
        {creating && (
          <CreatePaymentForm
            amount={amount}
            setAmount={setAmount}
            chainId={chainId}
            setChainId={setChainId}
            asset={asset}
            creationLocked={creationLocked}
            busy={busy}
            create={create}
            setCreating={setCreating}
          />
        )}

        <PaymentList
          page={query.data}
          loading={query.isPending}
          fetching={query.isFetching}
          error={query.error}
          filter={filter}
          setFilter={setFilter}
          limit={limit}
          setLimit={setLimit}
          cursors={cursors}
          setCursors={setCursors}
          streamState={streamState}
          pollPaused={pollPaused}
          refreshPayments={refreshPayments}
          onSelect={(id) => {
            setSelected(id);
            setMessage('');
          }}
        />
        {selected && (
          <PaymentDetail
            row={row}
            loading={detail.isPending}
            error={detail.error}
            setSelected={setSelected}
            busy={busy}
            setBusy={setBusy}
            links={links}
            setMessage={setMessage}
            issueLink={issueLink}
          />
        )}
        <p className="dashboard-footer">
          Non-custodial checkout · A submitted transaction is not a confirmed
          payment.
        </p>
      </main>
    </div>
  );
}
