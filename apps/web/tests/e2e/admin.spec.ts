import { type Page, type Route } from '@playwright/test';

import { expect, test } from './fixtures/auth';

// Platform admin lives on the apex domain (ADR-005) and authenticates
// via /api/admin/auth/me, not the clinic /api/auth/me the default
// fixture mocks. These tests stand up their own admin auth state per
// test via mockAdminApi, so we opt out of the fixture-level clinic
// auth here.
test.use({ authState: 'logged-out' });

/**
 * E2E for the platform-admin surface. The API is mocked at the route
 * layer so these run without a live NestJS — the
 * `admin.integration.spec.ts` in apps/api covers the live wiring.
 *
 * Platform admin lives at the APEX domain (ADR-005 boundary fix), so
 * these tests pass full `http://localhost:PORT/...` URLs to land on
 * apex even though the suite's default baseURL is the tenant
 * subdomain (where the majority of E2E tests run).
 *
 * Coverage:
 *   - Auth gate redirects unauthenticated visitors to /login
 *   - Full login → MFA → tenants table flow
 *   - Tenant creation form posts and lands on the new tenant detail
 *   - Suspend → status chip flips
 *   - Activate → status chip flips back
 */

const PORT = process.env.WEB_PORT ?? '3000';
const APEX_BASE_URL = `http://localhost:${PORT}`;

const TENANT_DONETAMED = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'DonetaMED',
  shortName: 'DONETAMED',
  subdomain: 'donetamed',
  city: 'Prizren',
  status: 'active',
  userCount: 2,
  patientCount: 11163,
  visitCount: 220465,
  createdAt: '2024-02-14T10:00:00.000Z',
  lastActivityAt: '2026-05-14T13:23:00.000Z',
};

const TENANT_AURORA = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Aurora Pediatri',
  shortName: 'AURORA-PED',
  subdomain: 'aurora-ped',
  city: 'Prishtinë',
  status: 'active',
  userCount: 1,
  patientCount: 0,
  visitCount: 0,
  createdAt: '2026-05-14T12:00:00.000Z',
  lastActivityAt: null,
};

function tenantDetailPayload(id: string, status: 'active' | 'suspended'): unknown {
  const base = id === TENANT_AURORA.id ? TENANT_AURORA : TENANT_DONETAMED;
  return {
    tenant: {
      ...base,
      status,
      address: 'Rr. Adem Jashari',
      phones: ['045 83 00 83'],
      contactEmail: 'info@donetamed.health',
      users: [
        {
          id: 'u-1',
          email: 'taulant.shala@klinika.health',
          firstName: 'Taulant',
          lastName: 'Shala',
          // TenantUser.roles is an array (ADR-004 multi-role) — the
          // page renders `user.roles.map(...)`, so a singular `role`
          // field crashes the whole tenant-detail view at render time.
          roles: ['doctor'],
          isActive: true,
          lastLoginAt: '2026-05-14T13:00:00.000Z',
        },
      ],
      telemetry: {
        lastHeartbeatAt: '2026-05-14T13:24:00.000Z',
        appHealthy: true,
        dbHealthy: true,
        orthancHealthy: true,
        cpuPercent: 18,
        ramPercent: 42,
        diskPercent: 14,
        lastBackupAt: '2026-05-14T07:00:00.000Z',
        queueDepth: 0,
        errorRate5xx: 0,
      },
      recentAudit: [
        {
          id: 'a-1',
          action: 'auth.login.success',
          resourceType: 'session',
          timestamp: '2026-05-14T13:00:00.000Z',
          actorEmail: 'taulant.shala@klinika.health',
        },
      ],
    },
  };
}

async function mockAdminApi(
  page: Page,
  state: {
    authed?: boolean;
    tenantStatus?: 'active' | 'suspended';
  } = {},
) {
  let authed = state.authed ?? false;
  let currentStatus: 'active' | 'suspended' = state.tenantStatus ?? 'active';

  await page.route('**/api/admin/auth/me', async (route: Route) => {
    if (!authed) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        admin: {
          id: 'admin-1',
          email: 'founder@klinika.health',
          firstName: 'Klinika',
          lastName: 'Founder',
          lastLoginAt: '2026-05-14T12:00:00.000Z',
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      }),
    });
  });

  await page.route('**/api/admin/auth/login', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.email && body.password) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'mfa_required',
          pendingSessionId: 'pending-admin-token',
          maskedEmail: 'f…r@klinika.health',
        }),
      });
    } else {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
    }
  });

  await page.route('**/api/admin/auth/mfa/verify', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.code === '482613' && body.pendingSessionId) {
      authed = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': 'klinika_admin_session=test; Path=/; HttpOnly' },
        body: JSON.stringify({ status: 'authenticated' }),
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Kod i pasaktë.' }),
      });
    }
  });

  await page.route('**/api/admin/tenants', async (route: Route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(tenantDetailPayload(TENANT_AURORA.id, 'active')),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tenants: [{ ...TENANT_DONETAMED, status: currentStatus }, TENANT_AURORA],
      }),
    });
  });

  await page.route('**/api/admin/tenants/subdomain-availability**', async (route: Route) => {
    const url = new URL(route.request().url());
    const sub = url.searchParams.get('subdomain') ?? '';
    if (sub === 'donetamed') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: false, subdomain: sub, reason: 'Ky subdomain është i zënë.' }),
      });
      return;
    }
    if (sub === 'admin') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: false, subdomain: sub, reason: 'Ky subdomain është i rezervuar.' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ available: true, subdomain: sub }),
    });
  });

  await page.route(`**/api/admin/tenants/${TENANT_DONETAMED.id}`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tenantDetailPayload(TENANT_DONETAMED.id, currentStatus)),
    });
  });

  await page.route(`**/api/admin/tenants/${TENANT_DONETAMED.id}/suspend`, async (route: Route) => {
    currentStatus = 'suspended';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tenantDetailPayload(TENANT_DONETAMED.id, 'suspended')),
    });
  });

  await page.route(`**/api/admin/tenants/${TENANT_DONETAMED.id}/activate`, async (route: Route) => {
    currentStatus = 'active';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tenantDetailPayload(TENANT_DONETAMED.id, 'active')),
    });
  });

  await page.route(`**/api/admin/tenants/${TENANT_AURORA.id}**`, async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(tenantDetailPayload(TENANT_AURORA.id, 'active')),
    });
  });
}

test.describe('Platform admin', () => {
  test('unauthenticated visitor is bounced to /login', async ({ page }) => {
    // Platform admin login now lives at the apex `/login` route
    // (ADR-005 boundary fix). There is no dedicated `/admin/login`.
    await mockAdminApi(page, { authed: false });
    await page.goto(`${APEX_BASE_URL}/admin`);
    await expect(page).toHaveURL(/\/login\?redirect=/);
  });

  test('full login → MFA → tenants list', async ({ page }) => {
    await mockAdminApi(page, { authed: false });

    await page.goto(`${APEX_BASE_URL}/login`);
    await expect(page.getByRole('heading', { name: 'Hyrja për admin' })).toBeVisible();

    await page.getByLabel('Email').fill('founder@klinika.health');
    await page.getByLabel('Fjalëkalimi').fill('correct-horse-battery-staple');
    await page.getByRole('button', { name: 'Vazhdo' }).click();

    // The platform-admin MFA step renders the same shared component as
    // the clinic flow (see components/auth/mfa-verify-form.tsx) —
    // identical heading + 6-cell OTP layout, auto-submits on the 6th
    // digit.
    await expect(page.getByRole('heading', { name: 'Verifikoni se jeni ju' })).toBeVisible();
    await expect(page.getByLabel('Shifra 1')).toBeVisible();
    for (const digit of '482613') {
      await page.keyboard.press(digit);
    }

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Klinikat' })).toBeVisible();
    await expect(page.locator('[data-testid="tenant-row"]')).toHaveCount(2);
  });

  test('create-tenant form posts and lands on the new tenant detail', async ({ page }) => {
    await mockAdminApi(page, { authed: true });
    await page.goto(`${APEX_BASE_URL}/admin/tenants/new`);

    await page.getByLabel('Emri i plotë').fill('Aurora Pediatri');
    await page.getByLabel('Emri i shkurtuar').fill('AURORA-PED');
    await page.getByLabel('Qyteti').fill('Prishtinë');
    await page.locator('[data-testid="subdomain-input"]').fill('aurora-ped');
    await page.getByLabel('Adresa').fill('Rr. Shtejes 12');
    await page.getByLabel('Telefonat').fill('045 11 22 33');
    await page.getByLabel('Email kontakti').fill('info@aurora-ped.com');
    await page.getByLabel('Emri', { exact: true }).first().fill('Ana');
    await page.getByLabel('Mbiemri', { exact: true }).fill('Krasniqi');
    await page.getByLabel('Email', { exact: true }).last().fill('newadmin@aurora-ped.com');

    await expect(page.getByText('aurora-ped.klinika.health · i lirë')).toBeVisible();

    await page.getByRole('button', { name: 'Krijo klinikën' }).click();

    await expect(page).toHaveURL(new RegExp(`/admin/tenants/${TENANT_AURORA.id}`));
  });

  test('suspend then activate flips the status chip', async ({ page }) => {
    await mockAdminApi(page, { authed: true });
    await page.goto(`${APEX_BASE_URL}/admin/tenants/${TENANT_DONETAMED.id}`);

    await expect(page.locator('[data-testid="tenant-status"]')).toHaveText('Aktive');

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('[data-testid="suspend-tenant"]').click();
    await expect(page.locator('[data-testid="tenant-status"]')).toHaveText('Pezullim');

    await page.locator('[data-testid="activate-tenant"]').click();
    await expect(page.locator('[data-testid="tenant-status"]')).toHaveText('Aktive');
  });

  test('reserved subdomain blocks the submit button', async ({ page }) => {
    await mockAdminApi(page, { authed: true });
    await page.goto(`${APEX_BASE_URL}/admin/tenants/new`);

    await page.getByLabel('Emri i plotë').fill('Admin Klinike');
    await page.getByLabel('Emri i shkurtuar').fill('ADMIN');
    await page.getByLabel('Qyteti').fill('Prishtinë');
    await page.locator('[data-testid="subdomain-input"]').fill('admin');
    await expect(page.getByText('Ky subdomain është i rezervuar')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Krijo klinikën' })).toBeDisabled();
  });
});
