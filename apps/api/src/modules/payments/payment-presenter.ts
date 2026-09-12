import {
  getPaymentAsset,
  type MerchantPayment,
  type PaymentStatus,
} from '@chainpay/shared';
import type { payments } from '@chainpay/database';
import { fail } from '../../common/http/errors';
export function present(row: typeof payments.$inferSelect): MerchantPayment {
  const amount = BigInt(row.amountBaseUnits);
  const asset = getPaymentAsset(row.chainId);
  if (!asset)
    return fail(500, 'UNSUPPORTED_PAYMENT', 'Payment asset is unavailable');
  const scale = 10n ** BigInt(row.tokenDecimals);
  return {
    id: row.id,
    chainId: row.chainId,
    token: asset.token,
    tokenAddress: row.tokenAddress,
    tokenDecimals: row.tokenDecimals,
    amount: `${amount / scale}.${(amount % scale).toString().padStart(row.tokenDecimals, '0')}`,
    amountBaseUnits: row.amountBaseUnits,
    receiverAddress: row.receiverAddress,
    status: row.status as PaymentStatus,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  };
}
