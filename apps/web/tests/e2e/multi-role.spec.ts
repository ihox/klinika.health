import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Playwright E2E for the multi-role refactor (ADR-004). Like
 * auth.spec.ts, we mock the API surface end-to-end so the test runs
 * against the Next.js dev server alone — no live API or Postgres
 * needed. The mocks are intentionally specific so a frontend regression
 * on the wire shape (`roles` vs `role`, missing chip, wrong nav item)
 * fails the suite loudly.
 *
 * Three personas are exercised:
 *   - Dr. Taulant Shala — roles ['doctor', 'clinic_admin'] (the
 *     canonical multi-role case at DonetaMED).
 *   - Erëblirë Krasniqi — roles ['receptionist'] only.
 *   - Erëblirë (post-promotion) — roles ['receptionist', 'clinic_admin']
 *     to exercise the doctor>admin>receptionist redirect priority.
 */

const SESSION_COOKIE_HEADER =
  'klinika_session=test-session; Path=/; HttpOnly, klinika_trust=trusted-token; Path=/; HttpOnly';

interface MockUser {
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  roles: Array<'doctor' | 'receptionist' | 'clinic_admin'>;
}

const TAULANT: MockUser = {
  firstName: 'Taulant',
  lastName: 'Shala',
  email: 'taulant.shala@klinika.health',
  title: 'Dr.',
  roles: ['doctor', 'clinic_admin'],
};

const EREBL: MockUser = {
  firstName: 'Erëblirë',
  lastName: 'Krasniqi',
  email: 'ereblire.krasniqi@klinika.health',
  title: null,
  roles: ['receptionist'],
};

const EREBL_PROMOTED: MockUser = {
  ...EREBL,
  roles: ['receptionist', 'clinic_admin'],
};

function mockClinicIdentity(page: Page) {
  return page.route('**/api/auth/clinic-identity', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subdomain: 'donetamed', name: 'DonetaMED', shortName: 'DM' }),
    });
  });
}

function mockMe(page: Page, user: MockUser) {
  return page.route('**/api/auth/me', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: {
          id: '00000000-0000-0000-0000-000000000001',
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          roles: user.roles,
          title: user.title,
          clinicName: 'DonetaMED',
          clinicShortName: 'DM',
          createdAt: new Date('2024-02-14T10:00:00Z').toISOString(),
          lastLoginAt: new Date().toISOString(),
        },
      }),
    });
  });
}

function mockMfaVerifyAs(page: Page, user: MockUser, code = '482613') {
  return page.route('**/api/auth/mfa/verify', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.code === code && body.pendingSessionId) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'set-cookie': SESSION_COOKIE_HEADER },
        body: JSON.stringify({ roles: user.roles }),
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

function mockLoginMfaRequired(page: Page) {
  return page.route('**/api/auth/login', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    if (body.email && body.password) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'mfa_required',
          pendingSessionId: 'pending-session-token-multi-role',
          maskedEmail: 't…a@klinika.health',
        }),
      });
    } else {
      await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
    }
  });
}

function mockSessionsAndDevices(page: Page) {
  page.route('**/api/auth/sessions', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sessions: [] }),
    });
  });
  page.route('**/api/auth/trusted-devices', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ devices: [] }),
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Multi-role nav + redirect (ADR-004)', () => {
  test('Dr. Taulant (doctor + clinic_admin) lands on /doctor and sees three nav items', async ({
    page,
  }) => {
    await mockClinicIdentity(page);
    await mockLoginMfaRequired(page);
    await mockMfaVerifyAs(page, TAULANT);
    await mockMe(page, TAULANT);

    await page.goto('/login');
    await page.getByLabel('Email').fill(TAULANT.email);
    await page.getByLabel('Fjalëkalimi').fill('valid-password-here');
    await page.getByRole('button', { name: 'Hyr' }).click();

    await expect(page).toHaveURL(/\/verify\?/);
    for (const digit of '482613') await page.keyboard.press(digit);

    // Doctor wins on priority → /doctor.
    await expect(page).toHaveURL(/\/doctor$/, { timeout: 5000 });

    // Nav shows Pamja e ditës + Pacientët + Cilësimet — and NOT
    // Kalendari (the receptionist role is absent).
    await expect(page.getByRole('link', { name: 'Pamja e ditës' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pacientët' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cilësimet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Kalendari' })).toHaveCount(0);
  });

  test('Erëblirë (receptionist only) lands on /receptionist with only Kalendari in nav', async ({
    page,
  }) => {
    await mockClinicIdentity(page);
    await mockLoginMfaRequired(page);
    await mockMfaVerifyAs(page, EREBL);
    await mockMe(page, EREBL);

    await page.goto('/login');
    await page.getByLabel('Email').fill(EREBL.email);
    await page.getByLabel('Fjalëkalimi').fill('valid-password-here');
    await page.getByRole('button', { name: 'Hyr' }).click();

    await expect(page).toHaveURL(/\/verify\?/);
    for (const digit of '482613') await page.keyboard.press(digit);

    // Receptionist with no doctor / clinic_admin → /receptionist.
    await expect(page).toHaveURL(/\/receptionist$/, { timeout: 5000 });

    await expect(page.getByRole('link', { name: 'Kalendari' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pamja e ditës' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Pacientët' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Cilësimet' })).toHaveCount(0);
  });

  test('Erëblirë (receptionist + clinic_admin) lands on /cilesimet — clinic_admin beats receptionist', async ({
    page,
  }) => {
    await mockClinicIdentity(page);
    await mockLoginMfaRequired(page);
    await mockMfaVerifyAs(page, EREBL_PROMOTED);
    await mockMe(page, EREBL_PROMOTED);
    // The /cilesimet page makes a couple of additional API calls;
    // mock them as empty so the route gate clears.
    page.route('**/api/clinic/settings', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          general: {
            name: 'DonetaMED',
            shortName: 'DM',
            subdomain: 'donetamed',
            address: 'X',
            city: 'Prizren',
            phones: ['x'],
            email: 'x@x.test',
          },
          branding: { hasLogo: false, logoContentType: null, hasSignature: false },
          hours: {
            timezone: 'Europe/Belgrade',
            days: {
              mon: { open: false },
              tue: { open: false },
              wed: { open: false },
              thu: { open: false },
              fri: { open: false },
              sat: { open: false },
              sun: { open: false },
            },
            durations: [15],
            defaultDuration: 15,
          },
          paymentCodes: {},
          email: { mode: 'default', smtp: null },
        }),
      });
    });
    page.route('**/api/clinic/users', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ users: [] }),
      });
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill(EREBL_PROMOTED.email);
    await page.getByLabel('Fjalëkalimi').fill('valid-password-here');
    await page.getByRole('button', { name: 'Hyr' }).click();
    await expect(page).toHaveURL(/\/verify\?/);
    for (const digit of '482613') await page.keyboard.press(digit);
    await expect(page).toHaveURL(/\/cilesimet$/, { timeout: 5000 });

    // The two role-granted nav items show; doctor-only items don't.
    await expect(page.getByRole('link', { name: 'Kalendari' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cilësimet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pamja e ditës' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Pacientët' })).toHaveCount(0);
  });
});

test.describe('User menu chips', () => {
  test("Dr. Taulant's avatar dropdown lists Mjeku + Administrator i klinikës", async ({ page }) => {
    await mockClinicIdentity(page);
    await mockMe(page, TAULANT);
    mockSessionsAndDevices(page);

    // Land directly on /profili-im to skip the auth flow — the user
    // menu lives on every clinic surface, including the profile.
    await page.goto('/profili-im');
    await expect(page.getByRole('heading', { name: 'Profili im' })).toBeVisible();

    // Open the dropdown.
    const avatar = page.getByRole('button', {
      name: /Menyja e përdoruesit · Dr\. Taulant Shala/,
    });
    await avatar.click();

    // Both role chips visible inside the panel.
    const panel = page.getByRole('menu');
    await expect(panel.getByText('Mjeku')).toBeVisible();
    await expect(panel.getByText('Administrator i klinikës')).toBeVisible();
    await expect(panel.getByRole('menuitem', { name: /Profili im/ })).toBeVisible();
    await expect(panel.getByRole('menuitem', { name: 'Dilni' })).toBeVisible();

    // Escape closes.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});

test.describe('403 for misplaced navigation', () => {
  test('Erëblirë (receptionist only) typing /cilesimet hits the 403 page', async ({ page }) => {
    await mockClinicIdentity(page);
    await mockMe(page, EREBL);

    await page.goto('/cilesimet');

    // RouteGate replaces the URL to /forbidden.
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 5000 });
    await expect(
      page.getByRole('heading', { name: 'Ju nuk keni qasje në këtë seksion' }),
    ).toBeVisible();
    await expect(
      page.getByText('Kontaktoni administratorin e klinikës nëse mendoni se është gabim.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kthehu te faqja kryesore' })).toBeVisible();
  });

  test('Erëblirë typing /pacientet hits the 403 page', async ({ page }) => {
    await mockClinicIdentity(page);
    await mockMe(page, EREBL);

    await page.goto('/pacientet');
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 5000 });
  });

  test('Erëblirë typing /pamja-e-dites hits the 403 page', async ({ page }) => {
    await mockClinicIdentity(page);
    await mockMe(page, EREBL);

    await page.goto('/pamja-e-dites');
    await expect(page).toHaveURL(/\/forbidden$/, { timeout: 5000 });
  });
});
