'use client';

import { useRef } from 'react';
import {
  createPublicClient,
  createWalletClient,
  custom,
  erc20Abi,
  type Address,
  type EIP1193Provider,
} from 'viem';
import { baseSepolia, berachain } from 'viem/chains';
import { getPaymentAsset } from '@chainpay/shared';
import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import type { CheckoutSnapshot, CheckoutWallet } from './contracts';

export const CHECKOUT_CHAIN_ID = baseSepolia.id;
export const CHECKOUT_USDC: Address =
  '0x036cbd53842c5426634e7929541ec2318f3dcf7e';

/** Only an explicit EIP-1193 rejection proves that the wallet declined approval. */
export function isWalletRejection(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (
    typeof current === 'object' &&
    current !== null &&
    !seen.has(current)
  ) {
    seen.add(current);
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === 4001) return true;
    current = value.cause;
  }
  return false;
}

function assertSupported(snapshot: CheckoutSnapshot) {
  const asset = getPaymentAsset(snapshot.chainId);
  if (
    !asset ||
    snapshot.token !== asset.token ||
    snapshot.tokenDecimals !== asset.decimals ||
    snapshot.tokenAddress.toLowerCase() !== asset.tokenAddress.toLowerCase() ||
    !/^[1-9]\d*$/.test(snapshot.amountBaseUnits) ||
    BigInt(snapshot.amountBaseUnits) >= 2n ** 256n
  )
    throw new Error('Unsupported checkout asset or amount.');
  return asset;
}

async function postCheckout<T>(
  token: string,
  endpoint: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(
    `/v1/checkout/${encodeURIComponent(token)}/${endpoint}`,
    {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new Error(
      body?.message ??
        'Checkout authentication is unavailable. Please try again.',
    );
  }
  return (await response.json()) as T;
}

export function useCheckoutWallet(): CheckoutWallet {
  const account = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const authenticated = useRef<{ paymentId: string; address: Address } | null>(
    null,
  );
  const sending = useRef(false);

  async function clients(snapshot: CheckoutSnapshot) {
    const asset = assertSupported(snapshot);
    const chain = asset.kind === 'native' ? berachain : baseSepolia;
    if (!account.address || !account.connector || !account.isConnected) {
      throw new Error('Connect your wallet first.');
    }
    const address = account.address;
    const provider = (await account.connector.getProvider()) as EIP1193Provider;
    let sendRequested = false;
    const request: EIP1193Provider['request'] = (args) => {
      if (
        args.method === 'eth_sendTransaction' ||
        args.method === 'wallet_sendTransaction'
      ) {
        // Viem can fall back to another wallet namespace on some RPC errors.
        // Even then, allow only one send request: its outcome may be unknown.
        if (sendRequested) {
          return Promise.reject(
            new Error('Broadcast outcome is uncertain. Check wallet history.'),
          );
        }
        sendRequested = true;
      }
      return provider.request(
        args as Parameters<EIP1193Provider['request']>[0],
      );
    };
    // Never retry a wallet RPC request automatically: a transport error after a
    // send may mean the transaction was already broadcast.
    const transport = custom({ request }, { retryCount: 0 });
    const wallet = createWalletClient({
      account: address,
      chain,
      transport,
    });
    const publicClient = createPublicClient({
      chain,
      transport,
      cacheTime: 0,
    });
    async function assertIdentity() {
      const [chainId, addresses] = await Promise.all([
        wallet.getChainId(),
        wallet.getAddresses(),
      ]);
      if (chainId !== snapshot.chainId)
        throw new Error(`Switch your wallet to ${asset.name}.`);
      if (addresses[0]?.toLowerCase() !== address.toLowerCase()) {
        throw new Error(
          'Wallet account changed. Authenticate the selected wallet again.',
        );
      }
    }
    await assertIdentity();
    return { address, wallet, publicClient, assertIdentity, asset, chain };
  }

  async function checkBalance(snapshot: CheckoutSnapshot) {
    const { address, publicClient, assertIdentity } = await clients(snapshot);
    const asset = assertSupported(snapshot);
    const amount = BigInt(snapshot.amountBaseUnits);
    if (
      asset.kind === 'native' &&
      address.toLowerCase() === snapshot.receiverAddress.toLowerCase()
    )
      throw new Error('Payer and receiver must be different addresses.');
    const [native, bytecode, receiverCode] = await Promise.all([
      publicClient.getBalance({ address }),
      publicClient.getBytecode({ address }),
      asset.kind === 'native'
        ? publicClient.getBytecode({ address: snapshot.receiverAddress })
        : Promise.resolve(undefined),
    ]);
    if (bytecode && bytecode !== '0x')
      throw new Error('Only EOA wallets are supported.');
    if (receiverCode && receiverCode !== '0x')
      throw new Error('Native BERA requires an EOA receiver.');
    if (asset.kind === 'native') {
      const [gas, gasPrice] = await Promise.all([
        publicClient.estimateGas({
          account: address,
          to: snapshot.receiverAddress,
          value: amount,
          data: '0x',
        }),
        publicClient.getGasPrice(),
      ]);
      const requiredNative = amount + gas * gasPrice * 2n;
      if (native < requiredNative)
        throw new Error(
          'Insufficient BERA for the payment plus estimated gas allowance.',
        );
      await assertIdentity();
      return { usdc: 0n, assetBalance: native, native, requiredNative };
    }
    const usdc = await publicClient.readContract({
      address: asset.tokenAddress as Address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
    });
    if (usdc < amount) throw new Error('Insufficient USDC balance.');

    // Base also charges L1 data fees. This conservative allowance is a usability
    // check, not a quote; the wallet displays the actual current network fee.
    const [gas, gasPrice] = await Promise.all([
      publicClient.estimateContractGas({
        account: address,
        address: CHECKOUT_USDC,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [snapshot.receiverAddress, BigInt(snapshot.amountBaseUnits)],
      }),
      publicClient.getGasPrice(),
    ]);
    const requiredNative = gas * gasPrice * 2n + 10_000_000_000_000n;
    if (native < requiredNative)
      throw new Error('Insufficient test ETH for the estimated gas allowance.');
    await assertIdentity();
    return { usdc, assetBalance: usdc, native, requiredNative };
  }

  return {
    address: account.address,
    chainId: account.chainId,
    connected: account.isConnected,
    async connect() {
      const connector = connectors[0];
      if (!connector)
        throw new Error('Install an injected EVM wallet to continue.');
      await connectAsync({ connector });
    },
    async switchChain(chainId) {
      if (!getPaymentAsset(chainId)) throw new Error('Unsupported network.');
      await switchChainAsync({ chainId });
    },
    async authenticate(token, snapshot) {
      authenticated.current = null;
      const { address, wallet, publicClient, assertIdentity } =
        await clients(snapshot);
      if (
        getPaymentAsset(snapshot.chainId)?.kind === 'native' &&
        address.toLowerCase() === snapshot.receiverAddress.toLowerCase()
      )
        throw new Error(
          'This wallet is the receiver. Use a different payer wallet before authenticating.',
        );
      const bytecode = await publicClient.getBytecode({ address });
      if (bytecode && bytecode !== '0x')
        throw new Error('Only EOA wallets are supported.');
      const challenge = await postCheckout<{
        challengeId: string;
        message: string;
        expiresAt: string;
      }>(token, 'challenge', { payerAddress: address });
      const lines = challenge.message.split('\n');
      if (
        lines[0] !== 'ChainPay checkout authentication' ||
        lines[1] !== `Domain: ${window.location.origin}` ||
        lines[2] !== `Payment: ${snapshot.id}` ||
        lines[3] !== `Chain ID: ${snapshot.chainId}` ||
        lines[4] !== `Payer: ${address.toLowerCase()}` ||
        Date.parse(challenge.expiresAt) <= Date.now()
      ) {
        throw new Error(
          'The checkout challenge does not match this payment and origin.',
        );
      }
      await assertIdentity();
      const signature = await wallet.signMessage({
        message: challenge.message,
      });
      await assertIdentity();
      const session = await postCheckout<{
        paymentId: string;
        payerAddress: Address;
      }>(token, 'verify', { challengeId: challenge.challengeId, signature });
      await assertIdentity();
      if (
        session.paymentId !== snapshot.id ||
        session.payerAddress.toLowerCase() !== address.toLowerCase()
      ) {
        throw new Error('The checkout session does not match this wallet.');
      }
      authenticated.current = { paymentId: snapshot.id, address };
    },
    checkBalance,
    async send(snapshot, beforeBroadcast) {
      if (sending.current)
        throw new Error('A wallet request is already in progress.');
      sending.current = true;
      try {
        if (snapshot.status !== 'AWAITING_PAYMENT')
          throw new Error('This payment cannot accept another transfer.');
        const { address, wallet, publicClient, assertIdentity, asset, chain } =
          await clients(snapshot);
        if (
          authenticated.current?.paymentId !== snapshot.id ||
          authenticated.current.address.toLowerCase() !== address.toLowerCase()
        ) {
          throw new Error('Authenticate this wallet before sending.');
        }
        await checkBalance(snapshot);
        if (asset.kind === 'native') {
          // Estimate/call are read-only. Only the explicit send below can broadcast.
          await publicClient.call({
            account: address,
            to: snapshot.receiverAddress,
            value: BigInt(snapshot.amountBaseUnits),
            data: '0x',
          });
          await assertIdentity();
          beforeBroadcast();
          return await wallet.sendTransaction({
            account: address,
            chain,
            to: snapshot.receiverAddress,
            value: BigInt(snapshot.amountBaseUnits),
            data: '0x',
          });
        }
        const { result } = await publicClient.simulateContract({
          account: address,
          address: CHECKOUT_USDC,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [snapshot.receiverAddress, BigInt(snapshot.amountBaseUnits)],
        });
        if (!result)
          throw new Error('The token transfer simulation did not succeed.');
        await assertIdentity();
        beforeBroadcast();
        return await wallet.writeContract({
          account: address,
          chain,
          address: CHECKOUT_USDC,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [snapshot.receiverAddress, BigInt(snapshot.amountBaseUnits)],
        });
      } finally {
        sending.current = false;
      }
    },
  };
}
