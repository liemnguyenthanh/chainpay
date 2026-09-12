import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'https://localhost:13100',
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node e2e/start-web.cjs',
    url: 'https://localhost:13100',
    ignoreHTTPSErrors: true,
    timeout: 120000,
    reuseExistingServer: false,
  },
});
