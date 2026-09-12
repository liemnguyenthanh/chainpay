'use client';

import { useEffect, useRef, useState } from 'react';
import { formatUnits, type Hash } from 'viem';
import { getPaymentAsset } from '@chainpay/shared';
import { isWalletRejection, useCheckoutWallet } from '../wallet';
import { CheckoutApiError, submitTransaction } from '../api';
import {
  clearRejectedRecovery,
  readRecovery,
  recoveryKey,
  saveRecovery,
  withSendLock,
  type RecoveryRecord,
} from '../recovery';
import type { CheckoutSnapshot } from '../contracts';

export function useCheckoutActions(
  token: string,
  snapshot: CheckoutSnapshot | undefined,
  refresh: () => Promise<CheckoutSnapshot>,
) {
  const wallet = useCheckoutWallet();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [recovery, setRecovery] = useState<RecoveryRecord | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [historyHash, setHistoryHash] = useState('');
  const [balance, setBalance] = useState<{
    wallet: string;
    value: string;
  } | null>(null);
  const walletKey = `${wallet.address}:${wallet.chainId}`;
  const rememberBalance = (value: string) =>
    setBalance({ wallet: walletKey, value });
  useEffect(() => {
    if (!snapshot?.id) return;
    const load = () => {
      try {
        setRecovery(readRecovery(snapshot.id));
        setStorageReady(true);
      } catch (error) {
        setStorageReady(false);
        setMessage(
          error instanceof Error
            ? error.message
            : 'Browser storage unavailable. Do not send before checking wallet history.',
        );
      }
    };
    load();
    const onStorage = (event: StorageEvent) => {
      if (event.key === recoveryKey(snapshot.id) || event.key === null) load();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [snapshot?.id]);

  async function run(action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage(
        isWalletRejection(error)
          ? 'Wallet request rejected. No new transfer was approved.'
          : error instanceof Error
            ? error.message
            : 'Request unavailable. Check wallet history before sending again.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function submit(record: RecoveryRecord) {
    if (!record.hash)
      throw new Error('Enter the transaction hash from wallet history.');
    if (
      !wallet.address ||
      wallet.address.toLowerCase() !== record.payer.toLowerCase()
    )
      throw new Error(
        'Connect the original payer wallet to submit this transaction.',
      );
    const latest = await refresh();
    if (latest.status === 'CONFIRMED') return;
    try {
      await submitTransaction(token, record.hash);
    } catch (error) {
      if (!(error instanceof CheckoutApiError) || error.status !== 401)
        throw error;
      await wallet.authenticate(token, latest);
      await submitTransaction(token, record.hash);
    }
    const saved = { ...record, submitted: true };
    saveRecovery(saved);
    setRecovery(saved);
    setMessage(
      'Transaction submitted for server verification. Do not send another transfer.',
    );
    await refresh();
  }
  async function send() {
    if (!snapshot) return;
    await withSendLock(snapshot.id, async () => {
      const existing = readRecovery(snapshot.id);
      if (existing) {
        setRecovery(existing);
        throw new Error(
          'A previous transfer may exist. Recover or submit its hash; do not send again.',
        );
      }
      if (!wallet.address) throw new Error('Connect a wallet first.');
      if (
        getPaymentAsset(snapshot.chainId)?.kind === 'native' &&
        wallet.address.toLowerCase() === snapshot.receiverAddress.toLowerCase()
      )
        throw new Error(
          'This wallet is the receiver. Use a different payer wallet. If already authenticated, create a new payment for the different wallet.',
        );
      if (wallet.chainId !== snapshot.chainId)
        throw new Error('Switch to the payment network before sending.');
      let latest = await refresh();
      if (latest.status !== 'AWAITING_PAYMENT')
        throw new Error(
          'This payment is already being processed or confirmed. Do not send again.',
        );
      await wallet.authenticate(token, latest);
      const funds = await wallet.checkBalance(latest);
      rememberBalance(
        `${formatUnits(funds.assetBalance, latest.tokenDecimals)} ${latest.token} · ${formatUnits(funds.native, 18)} ${getPaymentAsset(latest.chainId)?.nativeSymbol}`,
      );
      if (funds.assetBalance < BigInt(latest.amountBaseUnits))
        throw new Error('Insufficient payment asset balance.');
      if (funds.native < funds.requiredNative || funds.native === 0n)
        throw new Error('Insufficient native balance for payment and gas.');
      latest = await refresh();
      if (latest.status !== 'AWAITING_PAYMENT')
        throw new Error(
          'This payment is already being processed or confirmed. Do not send again.',
        );
      const record: RecoveryRecord = {
        paymentId: latest.id,
        payer: wallet.address,
      };
      let broadcastStarted = false;
      let hash: Hash;
      try {
        hash = await wallet.send(latest, () => {
          saveRecovery(record);
          setRecovery(record);
          broadcastStarted = true;
        });
      } catch (error) {
        if (broadcastStarted && isWalletRejection(error)) {
          clearRejectedRecovery(latest.id);
          setRecovery(null);
        }
        if (broadcastStarted && !isWalletRejection(error))
          throw new Error(
            'Broadcast result is unknown. Check wallet history and recover the transaction hash. Do not send again.',
          );
        throw error;
      }
      const received = { ...record, hash };
      setRecovery(received);
      try {
        saveRecovery(received);
      } catch {
        throw new Error(
          `Transaction hash: ${hash}. Browser storage failed. Copy this hash now and use transaction recovery; do not send again.`,
        );
      }
      await submit(received);
    });
  }
  return {
    wallet,
    busy,
    message,
    recovery,
    storageReady,
    historyHash,
    setHistoryHash,
    balance,
    walletKey,
    rememberBalance,
    run,
    submit,
    send,
    setRecovery,
  };
}
