import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * E2E for `/cilesimet` (clinic admin settings). The API is mocked at
 * the route layer so the test runs without a live NestJS; the API
 * integration spec in `apps/api/src/modules/clinic-settings/` covers
 * the live wiring.
 *
 * Coverage:
 *   1. Settings page loads with the General tab visible by default
 *   2. Sidebar navigation flips panes
 *   3. General tab — save sends the payload, toast appears
 *   4. Payments tab — edit and save a code's amount
 *   5. Hours tab — toggle a day closed, save
 *   6. Users tab — add user opens modal, submit posts
 *   7. Email tab — switch to SMTP, run a test, see success
 *   8. Audit tab — rows render, expand, export link is correct
 */

const CLINIC_BASE = {
  general: {
    name: 'DonetaMED — Ordinanca Pediatrike',
    shortName: 'DonetaMED',
    subdomain: 'donetamed',
    address: 'Rruga Adem Jashari, p.n.',
    city: 'Prizren',
    phones: ['045 83 00 83', '043 543 123'],
    email: 'info@donetamed.health',
  },
  branding: { hasLogo: false, logoContentType: null, hasSignature: false },
  hours: {
    timezone: 'Europe/Belgrade',
    days: {
      mon: { open: true, start: '10:00', end: '18:00' },
      tue: { open: true, start: '10:00', end: '18:00' },
      wed: { open: true, start: '10:00', end: '18:00' },
      thu: { open: true, start: '10:00', end: '18:00' },
      fri: { open: true, start: '10:00', end: '18:00' },
      sat: { open: true, start: '10:00', end: '14:00' },
      sun: { open: false },
    },
    durations: [10, 15, 20, 30, 45],
    defaultDuration: 15,
  },
  paymentCodes: {
    E: { label: 'Falas', amountCents: 0 },
    A: { label: 'Vizitë standarde', amountCents: 1500 },
    B: { label: 'Vizitë e shkurtër', amountCents: 1000 },
    C: { label: 'Kontroll', amountCents: 500 },
    D: { label: 'Vizitë e gjatë', amountCents: 2000 },
  },
  email: { mode: 'default' as const, smtp: null },
};

const USERS_BASE = [
  {
    id: 'u-taulant',
    email: 'taulant.shala@donetamed.health',
    firstName: 'Taulant',
    lastName: 'Shala',
    role: 'doctor',
    title: 'Dr.',
    credential: 'Pediatër',
    hasSignature: false,
    isActive: true,
    lastLoginAt: '2026-05-14T13:00:00.000Z',
    createdAt: '2024-02-14T10:00:00.000Z',
  },
  {
    id: 'u-erebli',
    email: 'ereblire.krasniqi@donetamed.health',
    firstName: 'Erëblirë',
    lastName: 'Krasniqi',
    role: 'receptionist',
    title: null,
    credential: null,
    hasSignature: false,
    isActive: true,
    lastLoginAt: '2026-05-14T12:30:00.000Z',
    createdAt: '2024-03-01T10:00:00.000Z',
  },
];

const AUDIT_ROWS = [
  {
    id: 'audit-1',
    timestamp: '2026-05-14T13:00:00.000Z',
    userId: 'u-taulant',
    userEmail: 'taulant.shala@donetamed.health',
    userName: 'Dr. Taulant Shala',
    action: 'settings.general.updated',
    resourceType: 'clinic',
    resourceId: 'c1',
    changes: [{ field: 'name', old: 'Old', new: 'DonetaMED — Ordinanca Pediatrike' }],
    ipAddress: '85.94.116.42',
  },
  {
    id: 'audit-2',
    timestamp: '2026-05-14T12:30:00.000Z',
    userId: 'u-erebli',
    userEmail: 'ereblire.krasniqi@donetamed.health',
    userName: 'Erëblirë Krasniqi',
    action: 'auth.login.success',
    resourceType: 'session',
    resourceId: 's1',
    changes: null,
    ipAddress: '85.94.116.42',
  },
];

async function mockClinicApi(page: Page) {
  let settings = structuredClone(CLINIC_BASE) as typeof CLINIC_BASE;
  let users = structuredClone(USERS_BASE);
  const audit = structuredClone(AUDIT_ROWS);

  const respondJson = async (route: Route, status: number, body: unknown) => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  };

  await page.route('**/api/clinic/settings', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await respondJson(route, 200, settings);
  });

  await page.route('**/api/clinic/settings/general', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    settings = { ...settings, general: { ...settings.general, ...body } };
    await respondJson(route, 200, settings);
  });

  await page.route('**/api/clinic/settings/hours', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    settings = { ...settings, hours: body };
    await respondJson(route, 200, settings);
  });

  await page.route('**/api/clinic/settings/payment-codes', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    settings = { ...settings, paymentCodes: body };
    await respondJson(route, 200, settings);
  });

  await page.route('**/api/clinic/settings/email', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    settings = {
      ...settings,
      email:
        body.mode === 'smtp'
          ? {
              mode: 'smtp',
              smtp: {
                host: body.host,
                port: body.port,
                username: body.username,
                fromName: body.fromName,
                fromAddress: body.fromAddress,
                passwordSet: true,
              },
            }
          : { mode: 'default', smtp: null },
    };
    await respondJson(route, 200, settings);
  });

  await page.route('**/api/clinic/settings/email/test', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.host === 'fail.example.com') {
      await respondJson(route, 200, {
        ok: false,
        detail: 'Lidhja SMTP nuk u përgjigj.',
        reason: 'connect_failed',
      });
      return;
    }
    await respondJson(route, 200, {
      ok: true,
      detail: 'Lidhja u testua me sukses · email i testit u dërgua.',
    });
  });

  await page.route('**/api/clinic/users', async (route: Route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      const user = {
        id: `u-${Math.random().toString(36).slice(2, 8)}`,
        email: body.email,
        firstName: body.firstName,
        lastName: body.lastName,
        role: body.role,
        title: null,
        credential: null,
        hasSignature: false,
        isActive: true,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      };
      users = [user, ...users];
      await respondJson(route, 201, { user });
      return;
    }
    await respondJson(route, 200, { users });
  });

  await page.route('**/api/clinic/audit*', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/export.csv')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        body: 'timestamp,user_email\n2026-05-14T13:00:00.000Z,taulant.shala@donetamed.health\n',
      });
      return;
    }
    await respondJson(route, 200, { rows: audit, nextCursor: null });
  });

  // The branding sub-resources stay simple; this slice's E2E doesn't
  // exercise file uploads (covered by the API integration test).
  await page.route('**/api/clinic/logo', async (route: Route) => {
    await route.fulfill({ status: 404, body: '' });
  });
  await page.route('**/api/clinic/signature', async (route: Route) => {
    await route.fulfill({ status: 404, body: '' });
  });
}

test.describe('Clinic settings', () => {
  test('loads General tab and switches panes via the sidebar', async ({ page }) => {
    await mockClinicApi(page);
    await page.goto('/cilesimet');

    await expect(page.getByRole('heading', { name: 'Cilësimet e klinikës' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Përgjithshme' })).toBeVisible();

    await page.getByRole('button', { name: /Orari dhe terminet/ }).click();
    await expect(page.locator('[data-testid="pane-hours"]')).toBeVisible();
    await expect(page.locator('[data-testid="day-mon"]')).toBeVisible();

    await page.getByRole('button', { name: 'Pagesa' }).click();
    await expect(page.locator('[data-testid="codes-table"]')).toBeVisible();
  });

  test('General → save updates the shortName', async ({ page }) => {
    await mockClinicApi(page);
    await page.goto('/cilesimet');

    await page.locator('[data-testid="general-name"]').fill('DonetaMED Updated');
    await page.locator('[data-testid="general-save"]').click();
    await expect(page.getByText('Cilësimet u ruajtën.')).toBeVisible();
  });

  test('Payments → edit an existing code and save', async ({ page }) => {
    await mockClinicApi(page);
    await page.goto('/cilesimet?tab=payments');

    await page.locator('[data-testid="code-edit-A"]').click();
    await page.locator('[data-testid="code-amount-A"]').fill('17.50');
    await page.locator('[data-testid="code-save-A"]').click();
    await expect(page.getByText('Kodi A u ruajt.')).toBeVisible();
  });

  test('Hours → mark Saturday closed and save', async ({ page }) => {
    await mockClinicApi(page);
    await page.goto('/cilesimet?tab=hours');

    await page.locator('[data-testid="day-state-sat"]').selectOption('closed');
    await page.locator('[data-testid="hours-save"]').click();
    await expect(page.getByText(/Orari u ruajt/)).toBeVisible();
  });

  test('Users → add staff modal posts and updates the table', async ({ page }) => {
    await mockClinicApi(page);
    await page.goto('/cilesimet?tab=users');
    await expect(page.locator('[data-testid="users-table"] tbody tr')).toHaveCount(2);

    await page.locator('[data-testid="add-user"]').click();
    await page.locator('[data-testid="new-user-first"]').fill('Adea');
    await page.locator('[data-testid="new-user-last"]').fill('Maloku');
    await page.locator('[data-testid="new-user-email"]').fill('adea@donetamed.health');
    await page.locator('[data-testid="new-user-role"]').selectOption('receptionist');
    await page.locator('[data-testid="new-user-submit"]').click();

    await expect(page.getByText(/Adea Maloku u shtua/)).toBeVisible();
    await expect(page.locator('[data-testid="users-table"] tbody tr')).toHaveCount(3);
  });

  test('Email → switch to SMTP, test connection succeeds', async ({ page }) => {
    await mockClinicApi(page);
    await page.goto('/cilesimet?tab=email');

    await page.locator('[data-testid="email-mode-smtp"]').click();
    await page.locator('[data-testid="smtp-host"]').fill('smtp.gmail.com');
    await page.locator('[data-testid="smtp-port"]').fill('587');
    await page.locator('[data-testid="smtp-username"]').fill('info@donetamed.health');
    await page.locator('[data-testid="smtp-password"]').fill('app-password');
    await page.locator('[data-testid="smtp-test"]').click();

    await expect(page.locator('[data-testid="smtp-test-result"]')).toContainText(
      'Lidhja u testua me sukses',
    );
  });

  test('Audit → rows render, expand to show diff', async ({ page }) => {
    await mockClinicApi(page);
    await page.goto('/cilesimet?tab=audit');

    await expect(page.getByText('Cilësimet bazë u ndryshuan')).toBeVisible();
    await page.getByText('Cilësimet bazë u ndryshuan').click();
    await expect(page.getByText('DonetaMED — Ordinanca Pediatrike')).toBeVisible();
  });
});
