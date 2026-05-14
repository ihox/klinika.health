import { expect, test } from '@playwright/test';

const PORT = process.env.WEB_PORT ?? '3000';
const APEX_BASE_URL = `http://localhost:${PORT}`;

test.describe('Root redirect', () => {
  test('tenant root redirects to /login and renders the clinic welcome card', async ({ page }) => {
    await page.route('**/api/auth/clinic-identity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subdomain: 'donetamed', name: 'DonetaMED', shortName: 'DM' }),
      });
    });
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Mirë se erdhët' })).toBeVisible();
  });

  test('apex root redirects to /login and renders the platform-admin form', async ({ page }) => {
    await page.goto(`${APEX_BASE_URL}/`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Hyrja për admin' })).toBeVisible();
  });
});
