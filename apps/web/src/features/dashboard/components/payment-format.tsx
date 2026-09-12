import Link from 'next/link';
import type { PaymentStatus } from '@chainpay/shared';
export type Merchant = { id: string; name: string };
export const labels: Record<PaymentStatus, string> = {
  AWAITING_PAYMENT: 'Awaiting payment',
  PROCESSING: 'Processing',
  CONFIRMED: 'Confirmed',
};
export const date = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Request unavailable. Try again.';
export function Badge({ status }: { status: PaymentStatus }) {
  return (
    <span className={`badge status-${status.toLowerCase()}`}>
      {labels[status]}
    </span>
  );
}
export function Brand() {
  return (
    <Link className="brand" href="/" aria-label="ChainPay home">
      <span className="brand-mark" aria-hidden="true">
        C
      </span>
      ChainPay <span className="brand-suffix">Mini</span>
    </Link>
  );
}
