/* eslint-disable @typescript-eslint/no-require-imports -- Fixtures load compiled CommonJS modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { encodeFunctionData, erc20Abi } = require('viem');
const { RpcVerifier, RpcBindingChainReader } = require('../dist');
const { CHAIN_ID, TOKEN_ADDRESS } = require('@chainpay/shared');
const input = {
  chainId: CHAIN_ID,
  tokenAddress: TOKEN_ADDRESS,
  txHash: `0x${'aa'.repeat(32)}`,
  payerAddress: `0x${'11'.repeat(20)}`,
  receiverAddress: `0x${'22'.repeat(20)}`,
  amountBaseUnits: '1000001',
  startBlock: '100',
};
function fixture(overrides = {}) {
  const blockHash = `0x${'bb'.repeat(32)}`;
  const tx = {
    hash: input.txHash,
    from: input.payerAddress,
    to: TOKEN_ADDRESS,
    input: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [input.receiverAddress, 1000001n],
    }),
    value: 0n,
  };
  const log = {
    address: TOKEN_ADDRESS,
    topics: [
      '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
      `0x${input.payerAddress.slice(2).padStart(64, '0')}`,
      `0x${input.receiverAddress.slice(2).padStart(64, '0')}`,
    ],
    data: `0x${1000001n.toString(16).padStart(64, '0')}`,
    logIndex: 2,
  };
  const receipt = {
    transactionHash: input.txHash,
    from: input.payerAddress,
    to: TOKEN_ADDRESS,
    status: 'success',
    blockNumber: 101n,
    blockHash,
    logs: [log],
  };
  const rpc = {
    getChainId: async () => CHAIN_ID,
    getBlockNumber: async () => 103n,
    getCode: async () => '0x',
    getTransaction: async () => tx,
    getReceipt: async () => receipt,
    getBlockHash: async () => blockHash,
    ...overrides,
  };
  return { rpc, tx, log, receipt, verifier: new RpcVerifier({ rpc }) };
}
test('direct exact transfer verifies with stable canonical inclusion and confirmations', async () => {
  const f = fixture();
  assert.deepEqual(await f.verifier.verify(input), {
    status: 'VERIFIED',
    evidence: {
      blockNumber: '101',
      blockHash: f.receipt.blockHash,
      logIndex: 2,
    },
  });
});
for (const [name, mutate] of [
  [
    'sender',
    (f) => {
      f.tx.from = input.receiverAddress;
    },
  ],
  [
    'token',
    (f) => {
      f.tx.to = input.receiverAddress;
    },
  ],
  [
    'receiver',
    (f) => {
      f.tx.input = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [input.payerAddress, 1000001n],
      });
    },
  ],
  [
    'amount',
    (f) => {
      f.tx.input = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [input.receiverAddress, 1000002n],
      });
    },
  ],
  [
    'stale block',
    (f) => {
      f.receipt.blockNumber = 100n;
    },
  ],
  [
    'revert',
    (f) => {
      f.receipt.status = 'reverted';
    },
  ],
  [
    'log token',
    (f) => {
      f.log.address = input.payerAddress;
    },
  ],
  [
    'log sender',
    (f) => {
      f.log.topics[1] = f.log.topics[2];
    },
  ],
  [
    'log receiver',
    (f) => {
      f.log.topics[2] = f.log.topics[1];
    },
  ],
  [
    'log amount',
    (f) => {
      f.log.data = `0x${'00'.repeat(32)}`;
    },
  ],
  [
    'removed log',
    (f) => {
      f.log.removed = true;
    },
  ],
  [
    'batch/router calldata',
    (f) => {
      f.tx.input += '00';
    },
  ],
  [
    'native value',
    (f) => {
      f.tx.value = 1n;
    },
  ],
  [
    'duplicate matching logs',
    (f) => {
      f.receipt.logs.push({ ...f.log, logIndex: 3 });
    },
  ],
])
  test(`rejects invalid ${name}`, async () => {
    const f = fixture();
    mutate(f);
    assert.equal((await f.verifier.verify(input)).status, 'REJECTED');
  });
test('unknown receipt and transaction remain pending', async () => {
  for (const method of ['getReceipt', 'getTransaction'])
    assert.equal(
      (await fixture({ [method]: async () => null }).verifier.verify(input))
        .status,
      'PENDING_CHAIN',
    );
});
test('insufficient confirmations preserve evidence', async () => {
  const f = fixture({ getBlockNumber: async () => 102n });
  assert.equal((await f.verifier.verify(input)).status, 'CONFIRMING');
});
test('timeouts, 429, configuration mismatch remain technical retry', async () => {
  for (const message of [
    'timeout',
    '429 Too Many Requests',
    'upstream internal',
  ]) {
    const f = fixture({
      getReceipt: async () => {
        throw new Error(message);
      },
    });
    assert.deepEqual(await f.verifier.verify(input), {
      status: 'RETRY',
      code: 'RPC_UNAVAILABLE',
    });
  }
  assert.equal(
    (await fixture({ getChainId: async () => 1 }).verifier.verify(input))
      .status,
    'RETRY',
  );
});
test('old inclusion and noncanonical receipt return pending', async () => {
  assert.equal(
    (
      await fixture().verifier.verify({
        ...input,
        previousBlockHash: `0x${'cc'.repeat(32)}`,
      })
    ).status,
    'PENDING_CHAIN',
  );
  assert.equal(
    (
      await fixture({
        getBlockHash: async () => `0x${'cc'.repeat(32)}`,
      }).verifier.verify(input)
    ).status,
    'PENDING_CHAIN',
  );
});
test('receipt disappearance or changed inclusion before settlement returns pending', async () => {
  for (const variant of ['missing', 'hash', 'number']) {
    const f = fixture();
    let reads = 0;
    f.rpc.getReceipt = async () =>
      ++reads === 1
        ? f.receipt
        : variant === 'missing'
          ? null
          : {
              ...f.receipt,
              ...(variant === 'hash'
                ? { blockHash: `0x${'cc'.repeat(32)}` }
                : { blockNumber: 102n }),
            };
    assert.equal((await f.verifier.verify(input)).status, 'PENDING_CHAIN');
  }
});
test('canonical block change during final read returns pending', async () => {
  const f = fixture();
  let reads = 0;
  f.rpc.getBlockHash = async () =>
    ++reads === 1 ? f.receipt.blockHash : `0x${'cc'.repeat(32)}`;
  assert.equal((await f.verifier.verify(input)).status, 'PENDING_CHAIN');
});
test('final receipt is fully revalidated even if block hash is unchanged', async () => {
  const f = fixture();
  let reads = 0;
  f.rpc.getReceipt = async () =>
    ++reads === 1 ? f.receipt : { ...f.receipt, logs: [] };
  assert.equal((await f.verifier.verify(input)).status, 'REJECTED');
});
test('payer must be EOA at binding and transfer block', async () => {
  const f = fixture({ getCode: async () => '0xef0100' });
  assert.equal((await f.verifier.verify(input)).status, 'REJECTED');
  await assert.rejects(
    new RpcBindingChainReader({ rpc: f.rpc }).getStartBlock(
      CHAIN_ID,
      input.payerAddress,
    ),
    /EOA_REQUIRED/,
  );
});
test('binding start block checks chain identity', async () => {
  assert.equal(
    await new RpcBindingChainReader({ rpc: fixture().rpc }).getStartBlock(
      CHAIN_ID,
      input.payerAddress,
    ),
    '103',
  );
  await assert.rejects(
    new RpcBindingChainReader({
      rpc: fixture({ getChainId: async () => 1 }).rpc,
    }).getStartBlock(CHAIN_ID, input.payerAddress),
    /RPC_CHAIN_MISMATCH/,
  );
});
test('confirmation policy cannot accidentally disable finality checks', () => {
  for (const confirmations of [0, 1, 1.5, NaN])
    assert.throws(() => new RpcVerifier({ rpc: fixture().rpc, confirmations }));
});

const { BERA_CHAIN_ID, NATIVE_TOKEN_ADDRESS } = require('@chainpay/shared');
const nativeInput = {
  ...input,
  chainId: BERA_CHAIN_ID,
  tokenAddress: NATIVE_TOKEN_ADDRESS,
  amountBaseUnits: '1000000000000001',
};
function nativeFixture(overrides = {}) {
  const f = fixture();
  f.tx.to = nativeInput.receiverAddress;
  f.tx.value = BigInt(nativeInput.amountBaseUnits);
  f.tx.input = '0x';
  f.receipt.to = nativeInput.receiverAddress;
  f.receipt.logs = [];
  Object.assign(f.rpc, { getChainId: async () => BERA_CHAIN_ID }, overrides);
  return f;
}
test('native BERA exact direct transfer verifies without token logs', async () => {
  const f = nativeFixture();
  assert.deepEqual(await f.verifier.verify(nativeInput), {
    status: 'VERIFIED',
    evidence: {
      blockNumber: '101',
      blockHash: f.receipt.blockHash,
      logIndex: -1,
    },
  });
});
for (const [name, mutate, code] of [
  [
    'value',
    (f) => {
      f.tx.value += 1n;
    },
    'WRONG_TRANSFER_VALUE',
  ],
  [
    'receiver',
    (f) => {
      f.tx.to = nativeInput.payerAddress;
    },
    'WRONG_RECEIVER',
  ],
  [
    'receipt receiver',
    (f) => {
      f.receipt.to = nativeInput.payerAddress;
    },
    'WRONG_RECEIVER',
  ],
  [
    'sender',
    (f) => {
      f.tx.from = nativeInput.receiverAddress;
    },
    'WRONG_SENDER',
  ],
  [
    'calldata',
    (f) => {
      f.tx.input = '0x00';
    },
    'DIRECT_NATIVE_TRANSFER_REQUIRED',
  ],
  [
    'revert',
    (f) => {
      f.receipt.status = 'reverted';
    },
    'TRANSACTION_REVERTED',
  ],
  [
    'old transfer',
    (f) => {
      f.receipt.blockNumber = 100n;
    },
    'TRANSFER_BEFORE_BINDING',
  ],
]) {
  test(`native BERA rejects wrong ${name}`, async () => {
    const f = nativeFixture();
    mutate(f);
    assert.deepEqual(await f.verifier.verify(nativeInput), {
      status: 'REJECTED',
      code,
    });
  });
}
test('native receiver and payer cannot be contracts or delegated accounts', async () => {
  for (const address of [
    nativeInput.receiverAddress,
    nativeInput.payerAddress,
  ]) {
    for (const code of ['0x60006000', '0xef0100123456']) {
      const f = nativeFixture({
        getCode: async (requested) => (requested === address ? code : '0x'),
      });
      assert.deepEqual(await f.verifier.verify(nativeInput), {
        status: 'REJECTED',
        code:
          address === nativeInput.receiverAddress
            ? 'NATIVE_RECEIVER_EOA_REQUIRED'
            : 'EOA_REQUIRED',
      });
    }
  }
});
test('native self transfer cannot settle a payment', async () => {
  const f = nativeFixture();
  f.tx.from = nativeInput.receiverAddress;
  f.receipt.from = nativeInput.receiverAddress;
  assert.deepEqual(
    await f.verifier.verify({
      ...nativeInput,
      payerAddress: nativeInput.receiverAddress,
    }),
    {
      status: 'REJECTED',
      code: 'SELF_TRANSFER_NOT_ALLOWED',
    },
  );
});
test('native wrong RPC chain and token configuration remain technical uncertainty', async () => {
  assert.deepEqual(
    await nativeFixture({ getChainId: async () => CHAIN_ID }).verifier.verify(
      nativeInput,
    ),
    {
      status: 'RETRY',
      code: 'RPC_CHAIN_CONFIGURATION',
    },
  );
  assert.deepEqual(
    await nativeFixture().verifier.verify({
      ...nativeInput,
      tokenAddress: TOKEN_ADDRESS,
    }),
    {
      status: 'RETRY',
      code: 'RPC_CHAIN_CONFIGURATION',
    },
  );
});
test('native missing receipt, outage and confirmation wait retain safe states', async () => {
  assert.equal(
    (
      await nativeFixture({ getReceipt: async () => null }).verifier.verify(
        nativeInput,
      )
    ).status,
    'PENDING_CHAIN',
  );
  assert.deepEqual(
    await nativeFixture({
      getReceipt: async () => {
        throw new Error('429');
      },
    }).verifier.verify(nativeInput),
    {
      status: 'RETRY',
      code: 'RPC_UNAVAILABLE',
    },
  );
  assert.deepEqual(
    await nativeFixture({ getBlockNumber: async () => 102n }).verifier.verify(
      nativeInput,
    ),
    {
      status: 'CONFIRMING',
      evidence: {
        blockNumber: '101',
        blockHash: `0x${'bb'.repeat(32)}`,
        logIndex: -1,
      },
    },
  );
});
test('native changed or disappeared inclusion never settles', async () => {
  for (const variant of ['missing', 'hash', 'number', 'canonical']) {
    const f = nativeFixture();
    let reads = 0;
    if (variant === 'canonical') {
      f.rpc.getBlockHash = async () =>
        ++reads === 1 ? f.receipt.blockHash : `0x${'cc'.repeat(32)}`;
    } else {
      f.rpc.getReceipt = async () =>
        ++reads === 1
          ? f.receipt
          : variant === 'missing'
            ? null
            : {
                ...f.receipt,
                ...(variant === 'hash'
                  ? { blockHash: `0x${'cc'.repeat(32)}` }
                  : { blockNumber: 102n }),
              };
    }
    assert.deepEqual(await f.verifier.verify(nativeInput), {
      status: 'PENDING_CHAIN',
      code: 'REORG_DETECTED',
    });
  }
});
test('native final transaction is fully revalidated', async () => {
  const f = nativeFixture();
  let reads = 0;
  f.rpc.getTransaction = async () =>
    ++reads === 1 ? f.tx : { ...f.tx, value: 0n };
  assert.deepEqual(await f.verifier.verify(nativeInput), {
    status: 'REJECTED',
    code: 'WRONG_TRANSFER_VALUE',
  });
});
test('RPC selection is per input chain for both binding and verification', async () => {
  const base = fixture();
  const bera = nativeFixture();
  const selected = [];
  const rpcForChain = (chainId) => {
    selected.push(chainId);
    return chainId === BERA_CHAIN_ID ? bera.rpc : base.rpc;
  };
  const verifier = new RpcVerifier({ rpcForChain });
  assert.equal((await verifier.verify(input)).status, 'VERIFIED');
  assert.equal((await verifier.verify(nativeInput)).status, 'VERIFIED');
  const binding = new RpcBindingChainReader({ rpcForChain });
  assert.equal(
    await binding.getStartBlock(BERA_CHAIN_ID, input.payerAddress),
    '103',
  );
  assert.equal(
    await binding.getStartBlock(CHAIN_ID, input.payerAddress),
    '103',
  );
  assert.deepEqual(selected, [
    CHAIN_ID,
    BERA_CHAIN_ID,
    BERA_CHAIN_ID,
    CHAIN_ID,
  ]);
});
