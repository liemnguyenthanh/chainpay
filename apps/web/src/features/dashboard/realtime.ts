import type { PaymentUpdateEvent } from '@chainpay/shared';

/** Events are hints, never row snapshots or pagination cursors. */
export function acceptPaymentEvent(
  raw: string,
  versions: Map<string, number>,
): PaymentUpdateEvent | null {
  let event: PaymentUpdateEvent;
  try {
    event = JSON.parse(raw) as PaymentUpdateEvent;
  } catch {
    return null;
  }
  if (
    !event ||
    typeof event.paymentId !== 'string' ||
    !Number.isSafeInteger(event.version) ||
    event.version < 0 ||
    !['AWAITING_PAYMENT', 'PROCESSING', 'CONFIRMED'].includes(event.status)
  )
    return null;
  if (event.version <= (versions.get(event.paymentId) ?? -1)) return null;
  rememberVersion(versions, event.paymentId, event.version);
  return event;
}

/** Both HTTP pagination and events share a bounded high-water mark cache. */
export function rememberVersion(
  versions: Map<string, number>,
  id: string,
  version: number,
) {
  const next = Math.max(version, versions.get(id) ?? -1);
  versions.delete(id);
  versions.set(id, next);
  if (versions.size > 2000) versions.delete(versions.keys().next().value!);
}
