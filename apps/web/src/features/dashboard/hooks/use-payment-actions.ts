'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getPaymentAsset, type MerchantPayment } from '@chainpay/shared';
import { MerchantApiError, merchantRequest } from '../api';
import { errorText } from '../components/payment-format';
export function usePaymentActions(
  merchantId: string,
  onCreated: (paymentId: string) => void,
) {
  const client = useQueryClient();
  const scope = ['merchant', merchantId];
  const [creating, setCreating] = useState(false);
  const [amount, setAmount] = useState('');
  const [chainId, setChainId] = useState(84532);
  const asset = getPaymentAsset(chainId)!;
  const [creationLocked, setCreationLocked] = useState(false);
  const createInFlight = useRef(false);
  const creation = useRef<{
    key: string;
    amount: string;
    chainId: number;
    payment?: MerchantPayment;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [links, setLinks] = useState<Record<string, string>>({});
  async function issueLink(id: string) {
    const { checkoutToken } = await merchantRequest<{ checkoutToken: string }>(
      `payments/${id}/checkout-token`,
      { method: 'POST' },
    );
    const url = `${window.location.origin}/checkout/${encodeURIComponent(checkoutToken)}`;
    setLinks((previous) => ({ ...previous, [id]: url }));
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    if (createInFlight.current) return;
    createInFlight.current = true;
    setBusy(true);
    setMessage('');
    creation.current ??= { key: crypto.randomUUID(), amount, chainId };
    setCreationLocked(true);
    try {
      const attempt = creation.current;
      attempt.payment ??= await merchantRequest<MerchantPayment>('payments', {
        method: 'POST',
        key: attempt.key,
        body: {
          amount: attempt.amount,
          token: getPaymentAsset(attempt.chainId)!.token,
          chainId: attempt.chainId,
        },
      });
      onCreated(attempt.payment.id);
      // A token failure must not cause another payment, nor silently retry token rotation.
      try {
        await issueLink(attempt.payment.id);
      } catch (error) {
        setMessage(
          `Payment created. Checkout link was not received: ${errorText(error)} Use “Issue checkout link” in its details to explicitly issue a new link.`,
        );
      }
      creation.current = null;
      setCreationLocked(false);
      setAmount('');
      setCreating(false);
      await client.invalidateQueries({ queryKey: scope });
    } catch (error) {
      if (error instanceof MerchantApiError && error.status === 400) {
        creation.current = null;
        setCreationLocked(false);
        setMessage(errorText(error));
      } else {
        setMessage(`${errorText(error)} Retry preserves this payment request.`);
      }
    } finally {
      createInFlight.current = false;
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await merchantRequest('merchant/session', { method: 'DELETE' });
      await client.cancelQueries({ queryKey: scope });
      client.removeQueries({ queryKey: scope });
      client.setQueryData(['merchant-session'], null);
    } catch (error) {
      setMessage(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return {
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
  };
}
