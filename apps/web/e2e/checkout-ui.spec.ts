import { test, expect } from '@playwright/test';
import { installFixtureWallet } from './fixtures';

const snapshot = {
  id: '00000000-0000-4000-8000-000000000001',
  chainId: 84532,
  token: 'USDC',
  tokenDecimals: 6,
  tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  receiverAddress: '0x1111111111111111111111111111111111111111',
  amountBaseUnits: '1250000',
  status: 'AWAITING_PAYMENT',
  version: 1,
  attempt: null,
};

for (const width of [375, 1440]) {
  for (const state of [
    'default',
    'pending',
    'review',
    'confirmed',
    'error',
  ] as const) {
    test(`checkout ${state} at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 960 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/v1/checkout/ui-fixture', async (route) => {
        await route.fulfill({
          status: state === 'error' ? 503 : 200,
          json:
            state === 'error'
              ? { message: 'Không thể tải thanh toán. Vui lòng thử lại sau.' }
              : {
                  ...snapshot,
                  status:
                    state === 'confirmed'
                      ? 'CONFIRMED'
                      : ['pending', 'review'].includes(state)
                        ? 'PROCESSING'
                        : 'AWAITING_PAYMENT',
                  attempt:
                    state === 'review'
                      ? { status: 'NEEDS_REVIEW', code: 'RPC_UNAVAILABLE' }
                      : null,
                },
        });
      });
      await page.goto('/checkout/ui-fixture');
      if (state === 'error') {
        await expect(page.locator('main').getByRole('alert')).toContainText(
          'Không thể tải',
        );
      } else {
        await expect(
          page.getByRole('heading', { name: '1.25 USDC', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText(snapshot.receiverAddress, { exact: true }),
        ).toBeVisible();
        if (state === 'default') {
          const details = page.locator('summary', {
            hasText: 'Payment details',
          });
          await details.focus();
          await page.keyboard.press('Enter');
          await expect(
            page.getByText(snapshot.tokenAddress, { exact: true }),
          ).toBeVisible();
          await page.keyboard.press('Enter');
        }
        if (state === 'confirmed')
          await expect(
            page.getByRole('button', { name: 'Connect wallet', exact: true }),
          ).toHaveCount(0);
        if (state === 'pending' || state === 'review') {
          await expect(
            page.getByText(/Do not send another transfer/).first(),
          ).toBeVisible();
          await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(
            0,
          );
          await expect(page.getByText('RPC_UNAVAILABLE')).toHaveCount(0);
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`${state}-${width}.png`),
        fullPage: true,
      });
    });
  }
}

test('connected wallet shows exact payment and optional recovery without broadcasting', async ({
  page,
}) => {
  const wallet = await installFixtureWallet(page);
  await page.route('**/v1/checkout/ui-fixture', (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto('/checkout/ui-fixture');
  await page
    .getByRole('button', { name: 'Connect wallet', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Pay 1.25 USDC', exact: true }),
  ).toBeEnabled();
  await expect(page.getByText(/this does not transfer funds/)).toBeVisible();
  await expect(
    page.getByLabel('Transaction hash from wallet history'),
  ).toBeHidden();
  await page.locator('summary', { hasText: 'Already paid?' }).click();
  await expect(
    page.getByLabel('Transaction hash from wallet history'),
  ).toBeVisible();
  expect(wallet.sends()).toBe(0);
});
