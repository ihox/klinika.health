import { expect, test } from '@playwright/test';

// The connection indicator polls /health/ready every 30s and surfaces
// online / offline / degraded. Playwright lets us intercept the fetch
// and force each state. The data-state attribute makes the assertion
// independent of Albanian translations / styling.

test.describe('Connection status indicator', () => {
  test('shows online when /health/ready returns 200', async ({ page }) => {
    await page.route('**/health/ready', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          db: { ok: true, latencyMs: 5 },
        }),
      }),
    );
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute(
      'data-state',
      'online',
    );
    // Per components/connection-status.html the online pill is
    // intentionally label-less — just the green dot. We assert that no
    // status copy is shown rather than searching for a missing string.
    await expect(page.getByRole('status')).toHaveText('');
  });

  test('shows degraded when /health/ready returns 503', async ({ page }) => {
    await page.route('**/health/ready', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'degraded',
          db: { ok: false, latencyMs: 0 },
        }),
      }),
    );
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute(
      'data-state',
      'degraded',
    );
    await expect(page.getByRole('status')).toContainText('I kufizuar');
  });

  test('shows offline when /health/ready aborts (simulated network drop)', async ({
    page,
    context,
  }) => {
    await page.route('**/health/ready', (route) => route.abort());
    await page.goto('/');
    await expect(page.getByRole('status')).toHaveAttribute(
      'data-state',
      'offline',
    );
    await expect(page.getByRole('status')).toContainText('Pa lidhje');

    // Restore connectivity: the next poll should flip to online.
    await page.unroute('**/health/ready');
    await page.route('**/health/ready', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', db: { ok: true, latencyMs: 1 } }),
      }),
    );
    await context.setOffline(false);
    await expect(page.getByRole('status')).toHaveAttribute(
      'data-state',
      'online',
      { timeout: 35_000 },
    );
  });
});
