import { defineConfig, devices } from '@playwright/test';

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
const WEB_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './apps/web/e2e',
  globalSetup: './apps/web/e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['github']] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    extraHTTPHeaders: {
      'X-Facility-ID': '00000000-0000-0000-0000-000000000001',
    },
  },
  projects: [
    {
      name: 'chromium',
      // Use full chromium binary (not chromium-headless-shell) so local runs work
      // without downloading the separate headless-shell package.
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: process.env['E2E_SKIP_WEBSERVER']
    ? undefined
    : [
        {
          // API server with the test-reset endpoint enabled
          command: 'pnpm --filter @coldchain/api dev',
          env: {
            NODE_ENV: 'development',
            ALLOW_TEST_RESET: '1',
            PORT: '3001',
          },
          url: `${API_URL}/health`,
          reuseExistingServer: !process.env['CI'],
          timeout: 120_000,
        },
        {
          command: 'pnpm --filter @coldchain/web dev',
          env: {
            NEXT_PUBLIC_API_URL: API_URL,
          },
          url: WEB_URL,
          reuseExistingServer: !process.env['CI'],
          timeout: 120_000,
        },
      ],
});
