import { CheckoutPage } from '@/features/checkout/checkout';
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <CheckoutPage token={token} />;
}
