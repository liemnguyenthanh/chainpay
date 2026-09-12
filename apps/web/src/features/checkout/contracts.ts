import type { Address, Hash } from 'viem';
export interface CheckoutSnapshot {
  id: string;
  chainId: number;
  token: 'USDC' | 'BERA';
  tokenAddress: Address;
  tokenDecimals: number;
  amountBaseUnits: string;
  receiverAddress: Address;
  status: 'AWAITING_PAYMENT' | 'PROCESSING' | 'CONFIRMED';
  version: number;
  attempt: { status: string; code: string | null } | null;
}
export interface CheckoutWallet {
  address?: Address;
  chainId?: number;
  connected: boolean;
  connect(): Promise<void>;
  switchChain(chainId: number): Promise<void>;
  authenticate(token: string, snapshot: CheckoutSnapshot): Promise<void>;
  checkBalance(snapshot: CheckoutSnapshot): Promise<{
    usdc: bigint;
    assetBalance: bigint;
    native: bigint;
    requiredNative: bigint;
  }>;
  send(snapshot: CheckoutSnapshot, beforeBroadcast: () => void): Promise<Hash>;
}
// UI persists an uncertainty marker synchronously in beforeBroadcast, and saves
// the returned hash synchronously before any API request. Only explicit wallet
// rejection may clear the marker; any other send error requires history recovery.
