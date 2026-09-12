import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  type Hex,
} from 'viem';
import {
  CHAIN_ID,
  BERA_CHAIN_ID,
  getPaymentAsset,
  type BindingChainReader,
  type VerificationInput,
  type VerificationResult,
  type Verifier,
} from '@chainpay/shared';

export interface ChainTransaction {
  hash: string;
  from: string;
  to: string | null;
  input: string;
  value: bigint;
}
export interface ChainLog {
  address: string;
  topics: readonly string[];
  data: string;
  logIndex: number | null;
  removed?: boolean;
}
export interface ChainReceipt {
  transactionHash: string;
  from: string;
  to: string | null;
  status: string;
  blockNumber: bigint;
  blockHash: string;
  logs: readonly ChainLog[];
}
/** Narrow, injectable RPC boundary; fixtures never require a wallet or live chain. */
export interface VerificationRpc {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  getCode(address: string, blockNumber?: bigint): Promise<string | undefined>;
  getTransaction(hash: string): Promise<ChainTransaction | null>;
  getReceipt(hash: string): Promise<ChainReceipt | null>;
  getBlockHash(blockNumber: bigint): Promise<string | null>;
}
function notFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    ['TransactionNotFoundError', 'TransactionReceiptNotFoundError'].includes(
      error.name,
    )
  );
}
export function createVerificationRpc(
  rpcUrl = process.env.BASE_SEPOLIA_RPC_URL,
): VerificationRpc {
  // No public default endpoint: an absent/misconfigured RPC stays technical uncertainty.
  const client = createPublicClient({
    transport: http(rpcUrl || 'http://127.0.0.1:0', {
      timeout: 10_000,
      retryCount: 0,
    }),
  });
  return {
    getChainId: () => client.getChainId(),
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    getCode: (address, blockNumber) =>
      client.getCode({ address: address as Hex, blockNumber }),
    getTransaction: async (hash) => {
      try {
        return await client.getTransaction({ hash: hash as Hex });
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    getReceipt: async (hash) => {
      try {
        return await client.getTransactionReceipt({ hash: hash as Hex });
      } catch (error) {
        if (notFound(error)) return null;
        throw error;
      }
    },
    getBlockHash: async (blockNumber) =>
      (await client.getBlock({ blockNumber })).hash,
  };
}
export interface RpcOptions {
  /** Fixture/single-endpoint overrides retain their previous behavior. */
  rpc?: VerificationRpc;
  rpcUrl?: string;
  rpcForChain?: (chainId: number) => VerificationRpc;
}
function rpcResolver(
  options: RpcOptions,
): (chainId: number) => VerificationRpc {
  const override =
    options.rpc ??
    (options.rpcUrl === undefined
      ? undefined
      : createVerificationRpc(options.rpcUrl));
  const clients = new Map<number, VerificationRpc>();
  return (chainId) => {
    if (override) return override;
    if (options.rpcForChain) return options.rpcForChain(chainId);
    let rpc = clients.get(chainId);
    if (!rpc) {
      // Each network must be explicitly configured; never fall back to another chain.
      const url =
        chainId === BERA_CHAIN_ID
          ? process.env.BERACHAIN_RPC_URL
          : chainId === CHAIN_ID
            ? process.env.BASE_SEPOLIA_RPC_URL
            : undefined;
      rpc = createVerificationRpc(url || 'http://127.0.0.1:0');
      clients.set(chainId, rpc);
    }
    return rpc;
  };
}
const equal = (a: string | null | undefined, b: string) =>
  a?.toLowerCase() === b.toLowerCase();
const isEoa = (code: string | undefined) => code === undefined || code === '0x';
export class RpcBindingChainReader implements BindingChainReader {
  private readonly rpcForChain: (chainId: number) => VerificationRpc;
  constructor(options: RpcOptions = {}) {
    this.rpcForChain = rpcResolver(options);
  }
  async getStartBlock(chainId: number, payerAddress: string): Promise<string> {
    if (!getPaymentAsset(chainId)) throw new Error('RPC_CHAIN_MISMATCH');
    const rpc = this.rpcForChain(chainId);
    if ((await rpc.getChainId()) !== chainId)
      throw new Error('RPC_CHAIN_MISMATCH');
    const block = await rpc.getBlockNumber();
    if (!isEoa(await rpc.getCode(payerAddress, block)))
      throw new Error('EOA_REQUIRED');
    return block.toString();
  }
}
const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const topicAddress = (address: string) =>
  `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;
export class RpcVerifier implements Verifier {
  private readonly rpcForChain: (chainId: number) => VerificationRpc;
  private readonly confirmations: bigint;
  constructor(options: RpcOptions & { confirmations?: number } = {}) {
    this.rpcForChain = rpcResolver(options);
    const confirmations =
      options.confirmations ?? Number(process.env.VERIFY_CONFIRMATIONS ?? 3);
    if (!Number.isSafeInteger(confirmations) || confirmations < 2)
      throw new Error('VERIFY_CONFIRMATIONS must be an integer >= 2');
    this.confirmations = BigInt(confirmations);
  }
  private inspect(
    input: VerificationInput,
    tx: ChainTransaction,
    receipt: ChainReceipt,
  ): VerificationResult {
    if (
      !equal(receipt.transactionHash, input.txHash) ||
      !equal(tx.hash, input.txHash)
    )
      return { status: 'RETRY', code: 'RPC_INCONSISTENT' };
    if (receipt.status === 'reverted')
      return { status: 'REJECTED', code: 'TRANSACTION_REVERTED' };
    if (receipt.status !== 'success')
      return { status: 'RETRY', code: 'RPC_INCONSISTENT' };
    if (receipt.blockNumber <= BigInt(input.startBlock))
      return { status: 'REJECTED', code: 'TRANSFER_BEFORE_BINDING' };
    if (
      !equal(tx.from, input.payerAddress) ||
      !equal(receipt.from, input.payerAddress)
    )
      return { status: 'REJECTED', code: 'WRONG_SENDER' };
    if (getPaymentAsset(input.chainId)?.kind === 'native') {
      if (
        !equal(tx.to, input.receiverAddress) ||
        !equal(receipt.to, input.receiverAddress)
      )
        return { status: 'REJECTED', code: 'WRONG_RECEIVER' };
      if (equal(input.payerAddress, input.receiverAddress))
        return { status: 'REJECTED', code: 'SELF_TRANSFER_NOT_ALLOWED' };
      if (tx.input !== '0x')
        return { status: 'REJECTED', code: 'DIRECT_NATIVE_TRANSFER_REQUIRED' };
      if (tx.value !== BigInt(input.amountBaseUnits))
        return { status: 'REJECTED', code: 'WRONG_TRANSFER_VALUE' };
      return {
        status: 'VERIFIED',
        evidence: {
          blockNumber: receipt.blockNumber.toString(),
          blockHash: receipt.blockHash.toLowerCase(),
          // Native value transfers emit no ERC-20 Transfer log. -1 identifies
          // transaction-level evidence; zero token address is config/DB only.
          logIndex: -1,
        },
      };
    }
    if (
      !equal(tx.to, input.tokenAddress) ||
      !equal(receipt.to, input.tokenAddress)
    )
      return { status: 'REJECTED', code: 'DIRECT_TOKEN_TRANSFER_REQUIRED' };
    const calldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [input.receiverAddress as Hex, BigInt(input.amountBaseUnits)],
    });
    if (!equal(tx.input, calldata) || tx.value !== 0n)
      return { status: 'REJECTED', code: 'WRONG_TRANSFER_CALL' };
    const matches = receipt.logs.filter(
      (log) =>
        equal(log.address, input.tokenAddress) &&
        log.topics.length === 3 &&
        equal(log.topics[0], TRANSFER_TOPIC) &&
        equal(log.topics[1], topicAddress(input.payerAddress)) &&
        equal(log.topics[2], topicAddress(input.receiverAddress)) &&
        /^0x[0-9a-f]{64}$/i.test(log.data) &&
        BigInt(log.data) === BigInt(input.amountBaseUnits) &&
        !log.removed &&
        log.logIndex !== null &&
        Number.isSafeInteger(log.logIndex) &&
        log.logIndex >= 0,
    );
    if (matches.length !== 1)
      return { status: 'REJECTED', code: 'INVALID_TRANSFER_LOG' };
    return {
      status: 'VERIFIED',
      evidence: {
        blockNumber: receipt.blockNumber.toString(),
        blockHash: receipt.blockHash.toLowerCase(),
        logIndex: matches[0]!.logIndex!,
      },
    };
  }
  async verify(input: VerificationInput): Promise<VerificationResult> {
    try {
      const asset = getPaymentAsset(input.chainId);
      if (!asset || !equal(input.tokenAddress, asset.tokenAddress))
        return { status: 'RETRY', code: 'RPC_CHAIN_CONFIGURATION' };
      const rpc = this.rpcForChain(input.chainId);
      if ((await rpc.getChainId()) !== input.chainId)
        return { status: 'RETRY', code: 'RPC_CHAIN_CONFIGURATION' };
      const receipt = await rpc.getReceipt(input.txHash);
      if (!receipt) return { status: 'PENDING_CHAIN', code: 'RECEIPT_PENDING' };
      if (
        (input.previousBlockHash &&
          !equal(receipt.blockHash, input.previousBlockHash)) ||
        !equal(await rpc.getBlockHash(receipt.blockNumber), receipt.blockHash)
      )
        return { status: 'PENDING_CHAIN', code: 'REORG_DETECTED' };
      const tx = await rpc.getTransaction(input.txHash);
      if (!tx) return { status: 'PENDING_CHAIN', code: 'TRANSACTION_PENDING' };
      const first = this.inspect(input, tx, receipt);
      if (first.status !== 'VERIFIED') return first;
      if (!isEoa(await rpc.getCode(input.payerAddress, receipt.blockNumber)))
        return { status: 'REJECTED', code: 'EOA_REQUIRED' };
      if (
        asset.kind === 'native' &&
        !isEoa(await rpc.getCode(input.receiverAddress, receipt.blockNumber))
      )
        return { status: 'REJECTED', code: 'NATIVE_RECEIVER_EOA_REQUIRED' };
      const head = await rpc.getBlockNumber();
      if (
        head < receipt.blockNumber ||
        head - receipt.blockNumber + 1n < this.confirmations
      )
        return { status: 'CONFIRMING', evidence: first.evidence };
      // Fresh receipt, transaction and canonical hash: never settle evidence from an earlier inclusion.
      const finalReceipt = await rpc.getReceipt(input.txHash);
      if (
        !finalReceipt ||
        !equal(finalReceipt.blockHash, receipt.blockHash) ||
        finalReceipt.blockNumber !== receipt.blockNumber
      )
        return { status: 'PENDING_CHAIN', code: 'REORG_DETECTED' };
      if (
        !equal(
          await rpc.getBlockHash(finalReceipt.blockNumber),
          finalReceipt.blockHash,
        )
      )
        return { status: 'PENDING_CHAIN', code: 'REORG_DETECTED' };
      const finalTx = await rpc.getTransaction(input.txHash);
      if (!finalTx)
        return { status: 'PENDING_CHAIN', code: 'TRANSACTION_PENDING' };
      const final = this.inspect(input, finalTx, finalReceipt);
      if (final.status === 'VERIFIED') {
        if (
          !isEoa(
            await rpc.getCode(input.payerAddress, finalReceipt.blockNumber),
          )
        )
          return { status: 'REJECTED', code: 'EOA_REQUIRED' };
        if (
          asset.kind === 'native' &&
          !isEoa(
            await rpc.getCode(input.receiverAddress, finalReceipt.blockNumber),
          )
        )
          return { status: 'REJECTED', code: 'NATIVE_RECEIVER_EOA_REQUIRED' };
        if (
          !equal(
            await rpc.getBlockHash(finalReceipt.blockNumber),
            finalReceipt.blockHash,
          )
        )
          return { status: 'PENDING_CHAIN', code: 'REORG_DETECTED' };
      }
      if (
        final.status === 'VERIFIED' &&
        final.evidence.logIndex !== first.evidence.logIndex
      )
        return { status: 'PENDING_CHAIN', code: 'REORG_DETECTED' };
      return final;
    } catch {
      return { status: 'RETRY', code: 'RPC_UNAVAILABLE' };
    }
  }
}
