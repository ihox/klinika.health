import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Playwright E2E for the auth flows. We mock the API endpoints rather
 * than depending on a running NestJS instance — that lets these tests
 * run inside the same CI job as the rest of the web suite and keeps
 * them fast. The auth.integration.spec.ts file exercises the live API
 * end of the stack.
 *
 * Each test installs a small in-memory state machine on `page.route`
 * for the relevant endpoints. The mocks are intentionally
 * pessimistic about request shape (assert what the controller would
 * accept) so a regression on the frontend payload trips a test
 * failure.
 */

function mockLoginMfaRequired(page: Page) {
  return page.route('**/api/auth/login', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.email && body.password) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'mfa_required',
          pendingSessionId: 'pending-session-token-xyz',
          maskedEmail: 't…a@donetamed.health',
        }),
      });
    } else {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
    }
  });
}

function mockMfaVerifySuccess(page: Page, code = '482613') {
  return page.route('**/api/auth/mfa/verify', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.code === code && body.pendingSessionId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          // Simulate the cookie set by the API on success.
          'set-cookie':
            'klinika_session=test-session; Path=/; HttpOnly, klinika_trust=trusted-token; Path=/; HttpOnly',
        },
        body: JSON.stringify({ role: 'doctor' }),
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ reason: 'invalid', message: 'Kod i pasaktë.' }),
      });
    }
  });
}

test.describe('Login + MFA', () => {
  test('full flow: login → MFA → doctor home', async ({ page }) => {
    await mockLoginMfaRequired(page);
    await mockMfaVerifySuccess(page);

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Mirë se erdhët' })).toBeVisible();

    await page.getByLabel('Email').fill('taulant.shala@donetamed.health');
    await page.getByLabel('Fjalëkalimi').fill('valid-password-here');
    await page.getByRole('button', { name: 'Hyr' }).click();

    await expect(page).toHaveURL(/\/verify\?/);
    await expect(page.getByRole('heading', { name: 'Verifikoni se jeni ju' })).toBeVisible();
    await expect(page.getByText('t…a@donetamed.health')).toBeVisible();

    // Type the 6 digits — the form auto-submits on the 6th.
    for (const digit of '482613') {
      await page.keyboard.press(digit);
    }

    // Brief success flash, then redirect to /doctor.
    await expect(page).toHaveURL(/\/doctor$/, { timeout: 5000 });
  });

  test('wrong password surfaces the Albanian error', async ({ page }) => {
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Email-i ose fjalëkalimi është i pasaktë.' }),
      });
    });
    await page.goto('/login');
    await page.getByLabel('Email').fill('taulant.shala@donetamed.health');
    await page.getByLabel('Fjalëkalimi').fill('wrong');
    await page.getByRole('button', { name: 'Hyr' }).click();
    await expect(page.getByRole('alert')).toContainText('Email-i ose fjalëkalimi është i pasaktë');
  });

  test('wrong MFA code shows error and remains on /verify', async ({ page }) => {
    await mockLoginMfaRequired(page);
    await mockMfaVerifySuccess(page, '482613');

    await page.goto('/login');
    await page.getByLabel('Email').fill('taulant.shala@donetamed.health');
    await page.getByLabel('Fjalëkalimi').fill('valid-password-here');
    await page.getByRole('button', { name: 'Hyr' }).click();
    await expect(page).toHaveURL(/\/verify\?/);

    for (const digit of '999999') {
      await page.keyboard.press(digit);
    }
    await expect(page.locator('text=Kod i pasaktë')).toBeVisible();
    await expect(page).toHaveURL(/\/verify\?/);
  });
});

test.describe('Trusted device (second login)', () => {
  test('login returns authenticated when trusted-device cookie present', async ({ page }) => {
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'authenticated', role: 'doctor' }),
      });
    });
    await page.goto('/login');
    await page.getByLabel('Email').fill('taulant.shala@donetamed.health');
    await page.getByLabel('Fjalëkalimi').fill('valid-password-here');
    await page.getByRole('button', { name: 'Hyr' }).click();
    await expect(page).toHaveURL(/\/doctor$/);
  });
});

test.describe('Password reset', () => {
  test('request → email sent confirmation', async ({ page }) => {
    await page.route('**/api/auth/password-reset/request', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      });
    });
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('taulant.shala@donetamed.health');
    await page.getByRole('button', { name: /Dërgo lidhjen/ }).click();
    await expect(page.getByText('Kontrolloni email-in')).toBeVisible();
  });

  test('confirm: type new password → land on login with success banner', async ({ page }) => {
    await page.route('**/api/auth/password-strength', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ strength: 'strong', acceptable: true }),
      });
    });
    await page.route('**/api/auth/password-reset/confirm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' }),
      });
    });
    await page.goto('/reset-password?t=valid-token-xyz');
    await page.getByLabel('Fjalëkalimi i ri').fill('Abc123def!XY');
    await page.getByLabel('Konfirmo').fill('Abc123def!XY');
    await page.getByRole('button', { name: /Vendos fjalëkalimin/ }).click();
    await expect(page).toHaveURL(/\/login\?reason=password-changed/);
    await expect(page.getByRole('alert')).toContainText('Fjalëkalimi u rivendos');
  });

  test('reset page without token shows error and link to forgot-password', async ({ page }) => {
    await page.goto('/reset-password');
    await expect(page.getByText('Lidhja nuk është e vlefshme')).toBeVisible();
    await expect(page.getByRole('link', { name: /Kërkoni një lidhje të re/ })).toBeVisible();
  });
});
