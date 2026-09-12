import { getPaymentAsset } from '@chainpay/shared';
import { fail } from '../../common/http/errors';
export function normalize(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return fail(400, 'INVALID_PAYMENT', 'Invalid payment input');
  const value = body as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !== 'amount,chainId,token' ||
    typeof value.chainId !== 'number'
  )
    return fail(400, 'INVALID_PAYMENT', 'Invalid payment input');
  const asset = getPaymentAsset(value.chainId);
  if (!asset || value.token !== asset.token)
    return fail(
      400,
      'INVALID_PAYMENT',
      'Unsupported chain and token combination',
    );
  if (
    typeof value.amount !== 'string' ||
    value.amount.length > 85 ||
    !new RegExp(`^\\d+(\\.\\d{1,${asset.decimals}})?$`).test(value.amount)
  )
    return fail(
      400,
      'INVALID_AMOUNT',
      `Amount must be a positive decimal string with at most ${asset.decimals} decimal places`,
    );
  const [whole, fraction = ''] = value.amount.split('.');
  const amount =
    BigInt(whole!) * 10n ** BigInt(asset.decimals) +
    BigInt(fraction.padEnd(asset.decimals, '0'));
  if (amount <= 0n || amount > (1n << 256n) - 1n)
    return fail(400, 'INVALID_AMOUNT', 'Amount is outside uint256 range');
  return {
    amount: amount.toString(),
    fingerprint: `${asset.chainId}:${asset.token}:${amount}`,
    asset,
  };
}
