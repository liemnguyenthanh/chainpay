import type { Hash } from 'viem';
import type { CheckoutSnapshot } from './contracts';
import { apiUrl } from '../api-origin';

export class CheckoutApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function checkoutRequest<T>(
  token: string,
  path = '',
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    apiUrl(`checkout/${encodeURIComponent(token)}${path}`),
    {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new CheckoutApiError(
      response.status,
      data.code ?? 'REQUEST_FAILED',
      data.message ?? 'Checkout request failed. Try again.',
    );
  return data as T;
}
export const getCheckout = (token: string) =>
  checkoutRequest<CheckoutSnapshot>(token);
export const submitTransaction = (token: string, txHash: Hash) =>
  checkoutRequest<unknown>(token, '/transactions', { txHash });
