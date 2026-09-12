import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { installFixtureWallet } from './fixtures';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { start } = require('./backend.cjs');
let backend: Awaited<ReturnType<typeof start>>;
const origin = 'https://localhost:13100';
const screenshots = resolve(__dirname, '../../..', 'docs/evidence/phase4');
test.beforeAll(async () => {
  backend = await start();
  await mkdir(screenshots, { recursive: true });
});
test.afterAll(async () => {
  await backend?.stop();
});
async function login(page: Page) {
  await page.goto('/');
  await page
    .getByLabel('Password', { exact: true })
    .fill('browser-fixture-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Create payment', exact: true }),
  ).toBeVisible();
}
async function create(page: Page) {
  await page
    .getByRole('button', { name: 'Create payment', exact: true })
    .click();
  await page.getByLabel('Amount (USDC)', { exact: true }).fill('1.25');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/v1/payments') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Create payment and link', exact: true })
    .click();
  const payment = await (await response).json();
  await expect(
    page.getByRole('link', { name: 'Open checkout', exact: true }),
  ).toBeVisible();
  const url = await page
    .getByRole('link', { name: 'Open checkout', exact: true })
    .getAttribute('href');
  return { ...payment, url };
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
for (const width of [375, 1440])
  test(`merchant login → create → checkout → realtime settlement at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let streamRequests = 0;
    await page.route('**/v1/merchant/events', async (route) => {
      streamRequests++;
      if (streamRequests === 1)
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            message: 'Fixture realtime temporarily unavailable',
          }),
        });
      await route.continue();
    });
    await page.addInitScript(() => {
      const Native = window.EventSource;
      Object.defineProperty(window, 'EventSource', {
        value: class extends Native {
          constructor(url: string | URL, config?: EventSourceInit) {
            super(url, config);
            this.addEventListener('payment', (event) => {
              const target = window as unknown as {
                receivedPaymentEvents?: unknown[];
              };
              (target.receivedPaymentEvents ??= []).push(
                JSON.parse((event as MessageEvent).data),
              );
            });
          }
        },
      });
    });
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'Welcome back.', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/login-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await page
      .getByLabel('Password', { exact: true })
      .fill('incorrect-fixture-password');
    await page.getByLabel('Password', { exact: true }).press('Tab');
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toHaveCSS('outline-style', 'solid');
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toHaveCSS('transition-duration', '0s');
    await page
      .getByRole('button', { name: 'Sign in', exact: true })
      .press('Enter');
    await expect(page.locator('main').getByRole('alert')).toContainText(
      'Invalid credentials',
    );
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({
      path: `${screenshots}/error-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await page
      .getByLabel('Password', { exact: true })
      .fill('browser-fixture-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Create payment', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `${screenshots}/dashboard-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    expect(streamRequests).toBeGreaterThanOrEqual(2);
    const payment = await create(page);
    expect(new URL(payment.url, origin).pathname).toMatch(
      /^\/checkout\/[A-Za-z0-9_-]{43}$/,
    );
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page
      .getByRole('button', { name: 'Copy checkout URL', exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      new URL(payment.url, origin).href,
    );
    const popup = page.waitForEvent('popup');
    await page
      .getByRole('link', { name: 'Open checkout', exact: true })
      .click();
    const checkout = await popup;
    await checkout.setViewportSize({ width, height: 1000 });
    await installFixtureWallet(checkout);
    await checkout.goto(payment.url);
    await expect(
      checkout.getByRole('heading', { name: '1.25 USDC', exact: true }),
    ).toBeVisible();
    await checkout.screenshot({
      path: `${screenshots}/checkout-default-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await checkout
      .getByRole('button', { name: 'Connect wallet', exact: true })
      .click();
    await checkout
      .getByRole('button', { name: 'Authenticate and pay USDC', exact: true })
      .click();
    await expect(
      checkout.getByText('Payment processing', { exact: true }),
    ).toBeVisible();
    await backend.dispatch();
    const row = page.getByTestId(`payment-row-${payment.id}`);
    await expect(row).toContainText('Processing');
    await noOverflow(page);
    await noOverflow(checkout);
    await page.screenshot({
      path: `${screenshots}/pending-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await checkout.screenshot({
      path: `${screenshots}/checkout-pending-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await backend.settle(payment.id);
    await backend.dispatch();
    await expect(row).toContainText('Confirmed');
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            (
              window as unknown as {
                receivedPaymentEvents?: { paymentId: string; status: string }[];
              }
            ).receivedPaymentEvents?.some(
              (event) => event.paymentId === id && event.status === 'CONFIRMED',
            ),
          payment.id,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `${screenshots}/confirmed-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await checkout
      .getByRole('button', { name: 'Refresh status', exact: true })
      .click();
    await expect(
      checkout.getByText('Payment confirmed', { exact: true }),
    ).toBeVisible();
    await checkout.screenshot({
      path: `${screenshots}/checkout-confirmed-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await row.getByRole('button').click();
    await expect(
      page.getByText(payment.id, { exact: true }).first(),
    ).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: `${screenshots}/detail-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await checkout.close();
  });

test('compound cursor stays stable when a new payment arrives', async ({
  page,
}) => {
  await login(page);
  for (let n = 0; n < 32; n++) {
    const response = await page.request.post('/v1/payments', {
      headers: { Origin: origin, 'Idempotency-Key': `pagination-${n}` },
      data: { amount: '2.50', token: 'USDC', chainId: 84532 },
    });
    expect(response.ok()).toBe(true);
  }
  await page
    .getByRole('button', { name: 'Refresh payments', exact: true })
    .click();
  await page.getByLabel('Page size', { exact: true }).selectOption('10');
  await expect(page.locator('[data-testid^="payment-row-"]')).toHaveCount(10);
  const first = await page
    .locator('[data-testid^="payment-row-"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));
  await page.request.post('/v1/payments', {
    headers: { Origin: origin, 'Idempotency-Key': 'pagination-new' },
    data: { amount: '9', token: 'USDC', chainId: 84532 },
  });
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.locator('[data-testid^="payment-row-"]')).toHaveCount(10);
  const second = await page
    .locator('[data-testid^="payment-row-"]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-testid')));
  expect(second.some((id) => first.includes(id))).toBe(false);
  await page
    .getByRole('button', { name: 'Previous page', exact: true })
    .click();
  await expect(page.locator('[data-testid^="payment-row-"]')).toHaveCount(10);
});

async function mockEvents(page: Page) {
  await page.addInitScript(() => {
    class FixtureEventSource extends EventTarget {
      onerror: (() => void) | null = null;
      constructor() {
        super();
        (
          window as unknown as { fixtureStream: FixtureEventSource }
        ).fixtureStream = this;
      }
      close() {}
    }
    Object.defineProperty(window, 'EventSource', { value: FixtureEventSource });
  });
}
async function emit(page: Page, type: string, data: unknown = {}) {
  await page.evaluate(
    ({ type, data }) => {
      (
        window as unknown as { fixtureStream: EventTarget }
      ).fixtureStream.dispatchEvent(
        new MessageEvent(type, { data: JSON.stringify(data) }),
      );
    },
    { type, data },
  );
}

test('duplicate/out-of-order hints, empty-filter membership, missed events, reconnect and focus recovery', async ({
  page,
}) => {
  await mockEvents(page);
  await login(page);
  const payment = await create(page);
  await page
    .getByRole('button', { name: 'Close details', exact: true })
    .click();
  await page
    .getByLabel('Status filter', { exact: true })
    .selectOption('PROCESSING');
  const row = page.getByTestId(`payment-row-${payment.id}`);
  await expect(row).toHaveCount(0);
  // No Pub/Sub notification: ready/reconnect must refetch even an empty filter without pending rows.
  const processing = await backend.fixtureState(payment.id, 'PROCESSING');
  await emit(page, 'ready');
  await expect(row).toContainText('Processing');
  let reads = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/v1/payments' &&
      request.method() === 'GET'
    )
      reads++;
  });
  await emit(page, 'payment', processing); // Already observed HTTP version.
  await emit(page, 'payment', {
    ...processing,
    version: processing.version - 1,
  });
  await page.waitForTimeout(250);
  expect(reads).toBe(0);
  const confirmed = await backend.fixtureState(payment.id, 'CONFIRMED');
  await emit(page, 'payment', confirmed);
  await expect(row).toHaveCount(0); // Leaves PROCESSING filter.
  await page
    .getByLabel('Status filter', { exact: true })
    .selectOption('CONFIRMED');
  await expect(row).toContainText('Confirmed');
  const baseline = reads;
  await emit(page, 'payment', processing); // Late lower version cannot resurrect old state.
  await emit(page, 'payment', confirmed); // Duplicate.
  await page.waitForTimeout(250);
  expect(reads).toBe(baseline);
  await expect(row).toContainText('Confirmed');
  // Miss a newly-created member entirely, then recover by browser focus.
  const response = await page.request.post('/v1/payments', {
    headers: { Origin: origin, 'Idempotency-Key': 'missed-focus' },
    data: { amount: '7.75', token: 'USDC', chainId: 84532 },
  });
  const missed = await response.json();
  await backend.fixtureState(missed.id, 'CONFIRMED');
  await expect(page.getByTestId(`payment-row-${missed.id}`)).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByTestId(`payment-row-${missed.id}`)).toContainText(
    'Confirmed',
  );
  // A second reconnect after another missed insert must refresh again, not just on first open.
  const added = await (
    await page.request.post('/v1/payments', {
      headers: { Origin: origin, 'Idempotency-Key': 'missed-reconnect' },
      data: { amount: '8.75', token: 'USDC', chainId: 84532 },
    })
  ).json();
  await backend.fixtureState(added.id, 'CONFIRMED');
  await emit(page, 'ready');
  await expect(page.getByTestId(`payment-row-${added.id}`)).toContainText(
    'Confirmed',
  );
});

test('dashboard pending fallback polling is bounded and manual refresh restarts it', async ({
  page,
}) => {
  await page.clock.install();
  await mockEvents(page);
  await login(page);
  await page.request.post('/v1/payments', {
    headers: { Origin: origin, 'Idempotency-Key': 'polling-fixture' },
    data: { amount: '1', token: 'USDC', chainId: 84532 },
  });
  await page
    .getByLabel('Status filter', { exact: true })
    .selectOption('AWAITING_PAYMENT');
  await expect(
    page.locator('[data-testid^="payment-row-"]').first(),
  ).toBeVisible();
  let reads = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === '/v1/payments' &&
      request.method() === 'GET'
    )
      reads++;
  });
  for (let n = 0; n < 60; n++) {
    await page.clock.runFor(5000);
    await expect(
      page.getByRole('button', { name: 'Refresh payments', exact: true }),
    ).toBeEnabled();
  }
  await expect(page.getByText(/Automatic polling paused/)).toBeVisible();
  const stopped = reads;
  await page.clock.runFor(60000);
  expect(reads).toBe(stopped);
  await page
    .getByRole('button', { name: 'Refresh payments', exact: true })
    .click();
  await expect.poll(() => reads).toBe(stopped + 1);
});

test('uncertain create acknowledgement preserves one payment and issues one checkout token', async ({
  page,
}) => {
  await mockEvents(page);
  await login(page);
  let committedId = '';
  const keys: string[] = [];
  let tokens = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/checkout-token')) tokens++;
  });
  await page.route('**/v1/payments', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    keys.push(route.request().headers()['idempotency-key'] ?? '');
    const response = await route.fetch();
    committedId = (await response.json()).id;
    if (keys.length === 1) await route.abort('connectionfailed');
    else await route.fulfill({ response });
  });
  await page
    .getByRole('button', { name: 'Create payment', exact: true })
    .click();
  await page.getByLabel('Amount (USDC)', { exact: true }).fill('3.25');
  await page
    .getByRole('button', { name: 'Create payment and link', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Retry payment creation', exact: true }),
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'Retry payment creation', exact: true })
    .click();
  await expect(
    page.getByRole('link', { name: 'Open checkout', exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[0]).toBe(keys[1]);
  expect(tokens).toBe(1);
  const body = await (await page.request.get('/v1/payments?limit=100')).json();
  expect(
    body.data.filter((row: { id: string }) => row.id === committedId),
  ).toHaveLength(1);
});

test('event arriving during initial empty filter fetch cancels stale membership response', async ({
  page,
}) => {
  await mockEvents(page);
  await login(page);
  const payment = await create(page);
  await page
    .getByRole('button', { name: 'Close details', exact: true })
    .click();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observed: () => void = () => {};
  const captured = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let first = true;
  await page.route('**/v1/payments?**', async (route) => {
    if (!route.request().url().includes('status=PROCESSING') || !first)
      return route.continue();
    first = false;
    const response = await route.fetch(); // Capture old DB snapshot before event changes membership.
    observed();
    await gate;
    await route.fulfill({ response }).catch(() => {}); // Request may correctly have been aborted.
  });
  await page
    .getByLabel('Status filter', { exact: true })
    .selectOption('PROCESSING');
  await captured;
  const event = await backend.fixtureState(payment.id, 'PROCESSING');
  await emit(page, 'payment', event);
  release();
  await expect(page.getByTestId(`payment-row-${payment.id}`)).toContainText(
    'Processing',
  );
});

test('revoked browser session hides merchant data and closes workspace', async ({
  page,
}) => {
  await mockEvents(page);
  await login(page);
  await create(page);
  await page.request.delete('/v1/merchant/session', {
    headers: { Origin: origin },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.locator('[data-testid^="payment-row-"]')).toHaveCount(0);
  await expect(page.getByLabel('Checkout URL', { exact: true })).toHaveCount(0);
});

test('checkout unavailable error fits mobile and desktop', async ({ page }) => {
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/checkout/${'x'.repeat(43)}`);
    await expect(page.locator('main').getByRole('alert')).toContainText(
      'Checkout not found',
    );
    await noOverflow(page);
    await page.screenshot({
      path: `${screenshots}/checkout-error-${width}.png`,
      fullPage: true,
      style: 'nextjs-portal { visibility: hidden; }',
    });
  }
});
