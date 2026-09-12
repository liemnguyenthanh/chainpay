import type { Address, Hash } from 'viem';
export interface RecoveryRecord {
  paymentId: string;
  payer: Address;
  hash?: Hash;
  submitted?: boolean;
}
export const recoveryKey = (id: string) => `chainpay:recovery:${id}`;
export function readRecovery(id: string): RecoveryRecord | null {
  const raw = localStorage.getItem(recoveryKey(id));
  if (!raw) return null;
  const value = JSON.parse(raw) as RecoveryRecord;
  if (
    value.paymentId !== id ||
    !/^0x[0-9a-fA-F]{40}$/.test(value.payer) ||
    (value.hash !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(value.hash))
  ) {
    throw new Error(
      'Saved transfer evidence cannot be read. Check wallet history before continuing.',
    );
  }
  return value;
}
export function saveRecovery(record: RecoveryRecord) {
  const value = JSON.stringify(record);
  localStorage.setItem(recoveryKey(record.paymentId), value);
  if (localStorage.getItem(recoveryKey(record.paymentId)) !== value)
    throw new Error(
      'Cannot save transfer recovery information. Enable browser storage before sending.',
    );
}
export function clearRejectedRecovery(id: string) {
  localStorage.removeItem(recoveryKey(id));
}
export async function withSendLock<T>(
  id: string,
  action: () => Promise<T>,
): Promise<T> {
  if (!navigator.locks)
    throw new Error(
      'This browser cannot safely coordinate checkout tabs. Use an up-to-date browser with Web Locks support.',
    );
  return navigator.locks.request(
    `chainpay:send:${id}`,
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          'Another tab is handling this payment. Check that tab and wallet history.',
        );
      return action();
    },
  );
}
