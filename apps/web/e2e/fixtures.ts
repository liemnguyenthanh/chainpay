import { expect, type Page } from '@playwright/test';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { encodeAbiParameters, type Hex } from 'viem';
let sequence = 0;
export async function installFixtureWallet(
  page: Page,
  options: {
    chain?: number;
    paymentChain?: number;
    receiverCode?: boolean;
    usdc?: bigint;
    native?: bigint;
    reject?: boolean;
    uncertain?: boolean;
  } = {},
) {
  const account = privateKeyToAccount(generatePrivateKey()); // Ephemeral fixture only; never a real funded key.
  let chain = options.chain ?? 84532;
  let sends = 0;
  let signatures = 0;
  const sent: unknown[] = [];
  const estimated: unknown[] = [];
  const hash = `0x${(++sequence).toString(16).padStart(64, '0')}`;
  await page.exposeFunction(
    'fixtureRpc',
    async ({ method, params }: { method: string; params: unknown[] }) => {
      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          return [account.address];
        case 'eth_chainId':
          return `0x${chain.toString(16)}`;
        case 'wallet_switchEthereumChain':
          chain = Number((params[0] as { chainId: string }).chainId);
          return null;
        case 'wallet_requestPermissions':
          return [{ parentCapability: 'eth_accounts' }];
        case 'wallet_getPermissions':
          return [{ parentCapability: 'eth_accounts' }];
        case 'eth_getCode':
          return options.receiverCode &&
            String(params[0]).toLowerCase() !== account.address.toLowerCase()
            ? '0x6000'
            : '0x';
        case 'eth_getBalance':
          return `0x${(options.native ?? 10n ** 18n).toString(16)}`;
        case 'eth_estimateGas':
          estimated.push(params[0]);
          return '0x11170';
        case 'eth_gasPrice':
          return '0x3b9aca00';
        case 'eth_call':
          if (
            !(params[0] as { data?: string }).data ||
            (params[0] as { data?: string }).data === '0x'
          )
            return '0x';
          return encodeAbiParameters(
            [{ type: 'uint256' }],
            [
              (params[0] as { data: string }).data.startsWith('0x70a08231')
                ? (options.usdc ?? 1000000000n)
                : 1n,
            ],
          );
        case 'personal_sign':
          signatures++;
          return account.signMessage({ message: { raw: params[0] as Hex } });
        case 'eth_sendTransaction':
          sends++;
          sent.push(params[0]);
          return options.reject
            ? { fixtureError: 4001 }
            : options.uncertain
              ? { fixtureError: -32000 }
              : hash;
        default:
          throw new Error(`Unhandled fixture RPC: ${method}`);
      }
    },
  );
  await page.addInitScript(() => {
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const provider = {
      on(event: string, fn: (...args: unknown[]) => void) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      removeListener(event: string, fn: (...args: unknown[]) => void) {
        listeners.get(event)?.delete(fn);
      },
      async request(args: { method: string; params?: unknown[] }) {
        const value = await (
          window as unknown as { fixtureRpc: (a: unknown) => Promise<unknown> }
        ).fixtureRpc({ ...args, params: args.params ?? [] });
        if (value && typeof value === 'object' && 'fixtureError' in value)
          throw Object.assign(new Error('Fixture wallet response'), {
            code: value.fixtureError,
          });
        if (args.method === 'wallet_switchEthereumChain')
          listeners
            .get('chainChanged')
            ?.forEach((fn) =>
              fn((args.params![0] as { chainId: string }).chainId),
            );
        return value;
      },
    };
    Object.defineProperty(window, 'ethereum', { value: provider });
  });
  return {
    hash,
    address: account.address,
    signatures: () => signatures,
    sends: () => sends,
    sent,
    estimated,
  };
}
export async function fixture(
  page: Page,
  options: Parameters<typeof installFixtureWallet>[1] = {},
) {
  const wallet = await installFixtureWallet(page, options);
  const login = await page.request.post('/v1/merchant/session', {
    headers: { Origin: 'https://localhost:13100' },
    data: { password: 'browser-fixture-password' },
  });
  expect(login.status()).toBe(201);
  const created = await page.request.post('/v1/payments', {
    headers: {
      Origin: 'https://localhost:13100',
      'Idempotency-Key': `browser-${crypto.randomUUID()}`,
    },
    data: {
      amount: '1.25',
      token: options.paymentChain === 80094 ? 'BERA' : 'USDC',
      chainId: options.paymentChain ?? 84532,
    },
  });
  expect(created.status()).toBe(201);
  const payment = await created.json();
  const issuance = await page.request.post(
    `/v1/payments/${payment.id}/checkout-token`,
    { headers: { Origin: 'https://localhost:13100' }, data: {} },
  );
  const { checkoutToken: token } = await issuance.json();
  await page.goto(`/checkout/${token}`);
  return { id: payment.id, token, ...wallet };
}
