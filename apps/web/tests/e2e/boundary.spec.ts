import { expect, test } from '@playwright/test';

/**
 * E2E for the platform-vs-clinic routing boundary (ADR-005 fix).
 *
 * Three host kinds, exercised against the same `pnpm dev` server:
 *   - apex  : http://localhost:PORT
 *   - tenant: http://donetamed.localhost:PORT  (default baseURL)
 *   - reserved: http://admin.localhost:PORT
 *
 * What this proves end-to-end:
 *   1. `/login` is host-aware — platform-admin form on apex, clinic
 *      form on tenant.
 *   2. Cross-scope paths (apex visiting /cilesimet, tenant visiting
 *      /admin) render the 404 EmptyState page.
 *   3. Reserved hosts get 404 regardless of path.
 *
 * The API is mocked at the page.route level so this doesn't require a
 * running NestJS instance.
 */

const PORT = process.env.WEB_PORT ?? '3000';
const APEX_BASE_URL = `http://localhost:${PORT}`;
const RESERVED_BASE_URL = `http://admin.localhost:${PORT}`;

test.describe('Boundary routing', () => {
  test('apex /login renders the platform-admin form', async ({ page }) => {
    await page.goto(`${APEX_BASE_URL}/login`);
    await expect(page.getByRole('heading', { name: 'Hyrja për admin' })).toBeVisible();
    await expect(page.getByText('Admini i Platformës')).toBeVisible();
    // The clinic identity card must NOT be present here.
    await expect(page.getByText('donetamed.klinika.health')).toHaveCount(0);
  });

  test('tenant /login renders the clinic welcome card', async ({ page }) => {
    await page.route('**/api/auth/clinic-identity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subdomain: 'donetamed', name: 'DonetaMED', shortName: 'DM' }),
      });
    });
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Mirë se erdhët' })).toBeVisible();
    // No platform-admin badge here.
    await expect(page.getByText('Admini i Platformës')).toHaveCount(0);
  });

  test('tenant visiting /admin renders the 404 page', async ({ page }) => {
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Faqja nuk u gjet')).toBeVisible();
  });

  test('tenant visiting /admin/tenants renders the 404 page', async ({ page }) => {
    const res = await page.goto('/admin/tenants');
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Faqja nuk u gjet')).toBeVisible();
  });

  test('apex visiting /cilesimet renders the 404 page', async ({ page }) => {
    const res = await page.goto(`${APEX_BASE_URL}/cilesimet`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Faqja nuk u gjet')).toBeVisible();
  });

  test('apex visiting /doctor renders the 404 page', async ({ page }) => {
    const res = await page.goto(`${APEX_BASE_URL}/doctor`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Faqja nuk u gjet')).toBeVisible();
  });

  test('apex visiting /pacient/:id renders the 404 page', async ({ page }) => {
    const res = await page.goto(`${APEX_BASE_URL}/pacient/some-id`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Faqja nuk u gjet')).toBeVisible();
  });

  test('reserved host returns 404 for any path', async ({ page }) => {
    // `admin.localhost` is the legacy admin-host nobody should use any
    // more — middleware classifies it as reserved and serves 404
    // regardless of path.
    const res = await page.goto(`${RESERVED_BASE_URL}/login`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText('Faqja nuk u gjet')).toBeVisible();
  });
});

test.describe('Boundary login flows (happy paths)', () => {
  test('platform admin login flow on apex — full happy path', async ({ page }) => {
    await page.route('**/api/admin/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'mfa_required',
          pendingSessionId: 'pending-admin-xyz',
          maskedEmail: 'f…r@klinika.health',
        }),
      });
    });
    await page.route('**/api/admin/auth/mfa/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie': 'klinika_admin_session=admin-test; Path=/; HttpOnly',
        },
        body: JSON.stringify({ status: 'authenticated' }),
      });
    });
    await page.route('**/api/admin/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          admin: {
            id: 'admin-1',
            email: 'founder@klinika.health',
            firstName: 'Founder',
            lastName: 'X',
            lastLoginAt: null,
            createdAt: '2026-01-01T00:00:00Z',
          },
        }),
      });
    });
    await page.route('**/api/admin/tenants', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ tenants: [] }),
      });
    });

    await page.goto(`${APEX_BASE_URL}/login`);
    await expect(page.getByRole('heading', { name: 'Hyrja për admin' })).toBeVisible();
    await page.getByLabel('Email').fill('founder@klinika.health');
    await page.getByLabel('Fjalëkalimi').fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Vazhdo' }).click();
    // The platform-admin MFA step now shares the clinic MFA component
    // (components/auth/mfa-verify-form.tsx), so the heading is the
    // unified "Verifikoni se jeni ju" and the form auto-submits on the
    // 6th digit.
    await expect(page.getByRole('heading', { name: 'Verifikoni se jeni ju' })).toBeVisible();
    await expect(page.getByLabel('Shifra 1')).toBeVisible();
    for (const digit of '482613') {
      await page.keyboard.press(digit);
    }
    await expect(page).toHaveURL(/\/admin$/);
  });

  test('clinic doctor login flow on tenant subdomain — full happy path', async ({ page }) => {
    await page.route('**/api/auth/clinic-identity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subdomain: 'donetamed', name: 'DonetaMED', shortName: 'DM' }),
      });
    });
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'mfa_required',
          pendingSessionId: 'pending-doctor-xyz',
          maskedEmail: 't…a@klinika.health',
        }),
      });
    });
    await page.route('**/api/auth/mfa/verify', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: {
          'set-cookie': 'klinika_session=doctor-test; Path=/; HttpOnly',
        },
        body: JSON.stringify({ role: 'doctor' }),
      });
    });

    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1, name: 'Mirë se erdhët' })).toBeVisible();
    await page.getByLabel('Email').fill('taulant.shala@klinika.health');
    await page.getByLabel('Fjalëkalimi').fill('valid-password-here');
    await page.getByRole('button', { name: 'Hyr' }).click();
    await expect(page).toHaveURL(/\/verify\?/);
    await expect(page.getByLabel('Shifra 1')).toBeVisible();
    for (const digit of '482613') {
      await page.keyboard.press(digit);
    }
    await expect(page).toHaveURL(/\/doctor$/, { timeout: 5000 });
  });
});
