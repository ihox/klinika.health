import { expect, test } from '@playwright/test';

test('home page renders the Klinika wordmark', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Klinika' })).toBeVisible();
});
