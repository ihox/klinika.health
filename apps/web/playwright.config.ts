import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WEB_PORT ?? 3000);
// Default baseURL points at the tenant subdomain — the bulk of the
// E2E suite exercises clinic flows (doctor, receptionist, chart,
// booking, …) which only render at a tenant host under the ADR-005
// boundary model. Apex/admin tests pass full `http://localhost:PORT`
// URLs explicitly so they're easy to spot.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://donetamed.localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
