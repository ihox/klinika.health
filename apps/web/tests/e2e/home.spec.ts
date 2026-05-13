import { expect, test } from '@playwright/test';

test('root redirects to /login and renders the welcome card', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Mirë se erdhët' })).toBeVisible();
});
