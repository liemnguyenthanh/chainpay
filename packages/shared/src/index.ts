export const CHAIN_ID = 84532;
export const TOKEN_ADDRESS = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';
export const BERA_CHAIN_ID = 80094;
/** Internal native-asset identifier only; never a transaction destination. */
export const NATIVE_TOKEN_ADDRESS =
  '0x0000000000000000000000000000000000000000';
export const PAYMENT_ASSETS = [
  {
    chainId: CHAIN_ID,
    token: 'USDC',
    tokenAddress: TOKEN_ADDRESS,
    decimals: 6,
    kind: 'erc20',
    name: 'Base Sepolia',
    nativeSymbol: 'ETH',
    explorerUrl: 'https://sepolia.basescan.org',
    rpcUrl: 'https://sepolia.base.org',
    testnet: true,
  },
  {
    chainId: BERA_CHAIN_ID,
    token: 'BERA',
    tokenAddress: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    kind: 'native',
    name: 'Berachain',
    nativeSymbol: 'BERA',
    explorerUrl: 'https://berascan.com',
    rpcUrl: 'https://rpc.berachain.com',
    testnet: false,
  },
] as const;
export function getPaymentAsset(chainId: number) {
  return PAYMENT_ASSETS.find((asset) => asset.chainId === chainId);
}
export type AttemptStatus =
  | 'SUBMITTED'
  | 'VERIFYING'
  | 'PENDING_CHAIN'
  | 'CONFIRMING'
  | 'REJECTED'
  | 'NEEDS_REVIEW'
  | 'VERIFIED';
export interface VerificationInput {
  chainId: number;
  txHash: string;
  tokenAddress: string;
  payerAddress: string;
  receiverAddress: string;
  amountBaseUnits: string;
  startBlock: string;
  previousBlockHash?: string | null;
}
export interface TransferEvidence {
  blockNumber: string;
  blockHash: string;
  logIndex: number;
}
export type VerificationResult =
  | { status: 'VERIFIED' | 'CONFIRMING'; evidence: TransferEvidence }
  | { status: 'PENDING_CHAIN' | 'REJECTED'; code: string }
  | { status: 'RETRY'; code: string };
export interface Verifier {
  verify(input: VerificationInput): Promise<VerificationResult>;
}
export interface BindingChainReader {
  getStartBlock(chainId: number, payerAddress: string): Promise<string>;
}
export const VERIFY_EVENT = 'VERIFY_ATTEMPT';
export const PAYMENT_EVENT = 'PAYMENT_UPDATED';
export const VERIFICATION_QUEUE = 'chainpay-verification';

export type PaymentStatus = 'AWAITING_PAYMENT' | 'PROCESSING' | 'CONFIRMED';
export interface PaymentUpdateEvent {
  paymentId: string;
  status: PaymentStatus;
  version: number;
}
export interface MerchantPayment {
  id: string;
  chainId: number;
  token: 'USDC' | 'BERA';
  tokenAddress: string;
  tokenDecimals: number;
  amount: string;
  amountBaseUnits: string;
  receiverAddress: string;
  status: PaymentStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
}
export interface MerchantPaymentDetail extends MerchantPayment {
  payerAddress: string | null;
  attempt: {
    id: string;
    txHash: string;
    status: AttemptStatus;
    code: string | null;
  } | null;
  settlement: {
    txHash: string;
    blockNumber: string;
    blockHash: string;
    logIndex: number;
  } | null;
}
export interface PaymentPage {
  data: MerchantPayment[];
  nextCursor: string | null;
}
