'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MerchantApiError, merchantRequest } from './api';
import { Brand, errorText, type Merchant } from './components/payment-format';
import { Workspace } from './components/workspace';
import './dashboard.css';
export function Dashboard() {
  const client = useQueryClient();
  const session = useQuery({
    queryKey: ['merchant-session'],
    queryFn: ({ signal }) =>
      merchantRequest<Merchant>('merchant/session', { signal }),
    retry: false,
    staleTime: 0,
  });
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const unauthorized =
    session.error instanceof MerchantApiError && session.error.status === 401;
  useEffect(() => {
    if (unauthorized) {
      void client.cancelQueries({ queryKey: ['merchant'] });
      client.removeQueries({ queryKey: ['merchant'] });
    }
  }, [client, unauthorized]);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const merchant = await merchantRequest<Merchant>('merchant/session', {
        method: 'POST',
        body: { password },
      });
      setPassword('');
      client.setQueryData(['merchant-session'], merchant);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  if (session.isPending)
    return (
      <main className="login-shell">
        <p role="status">Checking merchant session…</p>
      </main>
    );
  if (!session.data || unauthorized)
    return (
      <main className="login-shell">
        <Brand />
        <section className="login-card">
          <span className="eyebrow">MERCHANT WORKSPACE</span>
          <h1>Welcome back.</h1>
          <p className="muted">
            Manage USDC testnet and native BERA mainnet payments.
          </p>
          <form onSubmit={login}>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button disabled={busy} type="submit">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {message && (
            <p role="alert" className="alert error">
              {message}
            </p>
          )}
          {session.error &&
            !(
              session.error instanceof MerchantApiError &&
              session.error.status === 401
            ) && (
              <p role="alert" className="alert error">
                {errorText(session.error)}{' '}
                <button
                  className="secondary"
                  onClick={() => void session.refetch()}
                >
                  Retry connection
                </button>
              </p>
            )}
          <p className="fine-print">
            Use the merchant password configured by your operator. Review each
            payment network.
          </p>
        </section>
      </main>
    );
  return <Workspace key={session.data.id} merchant={session.data} />;
}
