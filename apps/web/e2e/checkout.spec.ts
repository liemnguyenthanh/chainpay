import { test, expect, type Page } from '@playwright/test';
import { fixture } from './fixtures';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { start } = require('./backend.cjs');
let backend: Awaited<ReturnType<typeof start>>;
test.beforeAll(async () => {
  backend = await start();
});
test.afterAll(async () => {
  await backend?.stop();
});

async function connect(page: Page) {
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
}
async function pay(page: Page) {
  await page
    .getByRole('button', { name: 'Pay 1.25 USDC', exact: true })
    .click();
}

test('HTTPS happy path: exact terms, scoped secure cookie, single transfer, backend confirmation', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await expect(
    page.getByRole('heading', { name: '1.25 USDC', exact: true }),
  ).toBeVisible();
  const snapshot = await (
    await page.request.get(`/v1/checkout/${f.token}`)
  ).json();
  expect(Object.keys(snapshot).sort()).toEqual(
    [
      'id',
      'chainId',
      'token',
      'tokenAddress',
      'tokenDecimals',
      'amountBaseUnits',
      'receiverAddress',
      'status',
      'version',
      'attempt',
    ].sort(),
  );
  await connect(page);
  await page
    .getByRole('button', { name: 'Pay 1.25 USDC', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect(
    page.getByText('Payment processing', { exact: true }),
  ).toBeVisible();
  expect(f.sends()).toBe(1);
  expect(await backend.count(f.id)).toBe(1);
  const cookie = (await context.cookies()).find(
    (c) => c.name === `chainpay_checkout_${f.id}`,
  )!;
  expect(cookie).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Strict',
    path: `/v1/checkout/${f.token}`,
  });
  expect(await page.evaluate(() => document.cookie)).not.toContain(cookie.name);
  await backend.settle(f.id);
  await page
    .getByRole('button', { name: 'Refresh status', exact: true })
    .click();
  await expect(
    page.getByText('Payment confirmed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Pay 1.25 USDC',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByText('Payment confirmed', { exact: true }),
  ).toBeVisible();
  expect(f.sends()).toBe(1);
});

test('wrong chain requires switch; wallet rejection clears only rejected approval', async ({
  page,
}) => {
  const f = await fixture(page, { chain: 1, reject: true });
  await connect(page);
  await expect(
    page.getByRole('button', {
      name: 'Pay 1.25 USDC',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Switch to Base Sepolia' }).click();
  await pay(page);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Wallet request rejected',
  );
  expect(f.sends()).toBe(1);
  expect(await backend.count(f.id)).toBe(0);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`chainpay:recovery:${id}`),
      f.id,
    ),
  ).toBeNull();
});
for (const kind of ['USDC', 'gas'] as const)
  test(`insufficient ${kind} prevents broadcast`, async ({ page }) => {
    const f = await fixture(
      page,
      kind === 'USDC' ? { usdc: 0n } : { native: 0n },
    );
    await connect(page);
    await pay(page);
    await expect(page.locator('main').getByRole('alert')).toContainText(
      kind === 'USDC' ? 'Insufficient USDC' : 'Insufficient test ETH',
    );
    expect(f.sends()).toBe(0);
  });

test('API failure after broadcast: persisted hash, reload and expired session resubmit same hash', async ({
  page,
  context,
}) => {
  const f = await fixture(page);
  await page.route('**/transactions', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'UNAVAILABLE',
        message: 'Fixture API unavailable',
      }),
    }),
  );
  await connect(page);
  await pay(page);
  await expect(page.getByTestId('saved-hash')).toHaveText(f.hash);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Fixture API unavailable',
  );
  expect(f.sends()).toBe(1);
  await context.clearCookies();
  await page.unroute('**/transactions');
  await page.reload();
  await expect(page.getByTestId('saved-hash')).toHaveText(f.hash);
  await expect(
    page.getByRole('button', {
      name: 'Pay 1.25 USDC',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit saved transaction' }).click();
  await expect(
    page.getByText('Payment processing', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Submit saved transaction' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Transaction submitted',
  );
  expect(await backend.count(f.id)).toBe(1);
  expect(f.sends()).toBe(1);
  await backend.review(f.id);
  await page
    .getByRole('button', { name: 'Refresh status', exact: true })
    .click();
  await expect(
    page.getByText('Verification needs review', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Pay 1.25 USDC',
      exact: true,
    }),
  ).toHaveCount(0);
});

test('ambiguous wallet broadcast never repeats and requires wallet history hash', async ({
  page,
}) => {
  const f = await fixture(page, { uncertain: true });
  await connect(page);
  await pay(page);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Broadcast result is unknown',
  );
  expect(f.sends()).toBe(1);
  await page.reload();
  await expect(
    page.getByRole('button', {
      name: 'Pay 1.25 USDC',
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel('Transaction hash from wallet history').fill(f.hash);
  await page
    .getByRole('button', { name: 'Save and submit recovered hash' })
    .click();
  await expect(
    page.getByText('Payment processing', { exact: true }),
  ).toBeVisible();
  expect(f.sends()).toBe(1);
});

test('origin/CSRF and CORS remain closed through same-origin proxy', async ({
  page,
}) => {
  const f = await fixture(page);
  for (const origin of [undefined, 'https://evil.example']) {
    const response = await page.request.post(
      `/v1/checkout/${f.token}/challenge`,
      {
        headers: origin ? { Origin: origin } : {},
        data: { payerAddress: '0x1111111111111111111111111111111111111111' },
      },
    );
    expect(response.status()).toBe(403);
    expect(response.headers()['access-control-allow-origin']).toBeUndefined();
  }
  const preflight = await page.request.fetch(
    `/v1/checkout/${f.token}/transactions`,
    {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://evil.example',
        'Access-Control-Request-Method': 'POST',
      },
    },
  );
  expect(preflight.headers()['access-control-allow-origin']).toBeUndefined();
});

test('lost API acknowledgement after commit recovers the same attempt', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.route('**/transactions', async (route) => {
    await route.fetch(); // Backend commits; browser never receives acknowledgement.
    await route.abort('connectionfailed');
  });
  await connect(page);
  await pay(page);
  await expect(page.getByTestId('saved-hash')).toHaveText(f.hash);
  await expect.poll(() => backend.count(f.id)).toBe(1);
  await page.unroute('**/transactions');
  await page.reload();
  await page.getByRole('button', { name: 'Submit saved transaction' }).click();
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Transaction submitted',
  );
  expect(await backend.count(f.id)).toBe(1);
  expect(f.sends()).toBe(1);
});

test('unwritable recovery storage prevents wallet broadcast', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('chainpay:recovery:'))
        throw new Error('Fixture storage unavailable');
      return original.call(this, key, value);
    };
  });
  await connect(page);
  await pay(page);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Fixture storage unavailable',
  );
  expect(f.sends()).toBe(0);
});

test('polling stops at its request budget and manual refresh resumes it', async ({
  page,
}) => {
  await page.clock.install();
  const f = await fixture(page);
  let reads = 0;
  await page.route(`**/v1/checkout/${f.token}`, async (route) => {
    reads++;
    await route.continue();
  });
  for (let i = 0; i < 60; i++) {
    await page.clock.runFor(5000);
    // Drain the real network request before advancing the next interval.
    await expect(
      page.getByRole('button', { name: 'Refresh status', exact: true }),
    ).toBeEnabled();
  }
  await expect(
    page.getByText('Automatic status checks paused. Refresh to check again.'),
  ).toBeVisible();
  const stoppedAt = reads;
  await page.clock.runFor(60000);
  expect(reads).toBe(stoppedAt);
  await page
    .getByRole('button', { name: 'Refresh status', exact: true })
    .click();
  await expect.poll(() => reads).toBe(stoppedAt + 1);
});
