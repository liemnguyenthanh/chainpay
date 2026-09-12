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
test('native self-transfer is explained and blocked before any wallet signature', async ({
  page,
}) => {
  const f = await fixture(page, { paymentChain: 80094, chain: 80094 });
  await page.route(`**/v1/checkout/${f.token}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, receiverAddress: f.address.toLowerCase() },
    });
  });
  await page.reload();
  await connect(page);
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'This wallet is the receiver',
  );
  await expect(
    page.getByRole('button', {
      name: 'Authenticate and pay BERA',
      exact: true,
    }),
  ).toBeDisabled();
  expect(f.signatures()).toBe(0);
  expect(f.sends()).toBe(0);
});
test('native BERA shows mainnet terms and sends exact value with empty calldata once', async ({
  page,
}) => {
  const f = await fixture(page, {
    paymentChain: 80094,
    chain: 80094,
    native: 2n * 10n ** 18n,
  });
  await expect(
    page.getByRole('heading', { name: '1.25 BERA', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('MAINNET · Real BERA', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/native-bera-checkout.png',
    fullPage: true,
  });
  await connect(page);
  await page
    .getByRole('button', { name: 'Authenticate and pay BERA', exact: true })
    .click();
  await expect(page.getByTestId('saved-hash')).toHaveText(f.hash);
  expect(f.sends()).toBe(1);
  expect(f.sent[0]).toMatchObject({
    to: '0x1111111111111111111111111111111111111111',
    value: '0x1158e460913d0000',
    data: '0x',
  });
  expect(f.estimated[0]).toMatchObject({
    to: '0x1111111111111111111111111111111111111111',
    value: '0x1158e460913d0000',
    data: '0x',
  });
});

for (const receiverCode of [false, true])
  test(`native BERA blocks ${receiverCode ? 'contract receiver' : 'balance without gas headroom'}`, async ({
    page,
  }) => {
    const f = await fixture(page, {
      paymentChain: 80094,
      chain: 80094,
      native: 125n * 10n ** 16n,
      receiverCode,
    });
    await connect(page);
    await page
      .getByRole('button', { name: 'Authenticate and pay BERA', exact: true })
      .click();
    await expect(page.locator('main').getByRole('alert')).toContainText(
      receiverCode ? 'EOA receiver' : 'payment plus estimated gas',
    );
    expect(f.sends()).toBe(0);
  });
