import { test as base, type Route } from '@playwright/test';

// Shared Playwright fixture for clinic auth.
//
// The chart shell, top nav, role guards, and most other authenticated
// surfaces call /api/auth/me + /api/auth/clinic-identity on mount.
// Without these mocked, every test redirects to /login on a 401 and
// the suite turns red.
//
// Each spec opts into a role by calling `test.use({ authState: ... })`.
// Default is 'doctor'. Tests that exercise the login flow itself opt
// into 'logged-out' so they can wire their own auth mocks.
//
// Route handlers registered here at fixture-setup time are
// superseded LIFO by any per-test `page.route` for the same URL,
// so tests can still override the mock when they need to.

export type AuthRole = 'doctor' | 'receptionist' | 'clinic_admin' | 'platform_admin';
export type AuthState = AuthRole | 'logged-out';

interface AuthFixtures {
  authState: AuthState;
}

interface MockUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  title: string | null;
  roles: AuthRole[];
}

const USERS: Record<AuthRole, MockUser> = {
  doctor: {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'taulant.shala@klinika.health',
    firstName: 'Taulant',
    lastName: 'Shala',
    title: 'Dr.',
    roles: ['doctor'],
  },
  receptionist: {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'ereblire.krasniqi@klinika.health',
    firstName: 'Erëblirë',
    lastName: 'Krasniqi',
    title: null,
    roles: ['receptionist'],
  },
  clinic_admin: {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'admin@donetamed.health',
    firstName: 'Klinika',
    lastName: 'Admin',
    title: null,
    roles: ['clinic_admin'],
  },
  platform_admin: {
    id: '00000000-0000-4000-8000-000000000004',
    email: 'platform@klinika.health',
    firstName: 'Platform',
    lastName: 'Admin',
    title: null,
    roles: ['platform_admin'],
  },
};

function meBody(role: AuthRole): string {
  const u = USERS[role];
  return JSON.stringify({
    user: {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      roles: u.roles,
      title: u.title,
      clinicName: 'DonetaMED',
      clinicShortName: 'DM',
      createdAt: '2024-02-14T10:00:00.000Z',
      lastLoginAt: '2026-05-14T13:00:00.000Z',
    },
  });
}

const CLINIC_IDENTITY_BODY = JSON.stringify({
  subdomain: 'donetamed',
  name: 'DonetaMED',
  shortName: 'DM',
});

export const test = base.extend<AuthFixtures>({
  authState: ['doctor', { option: true }],

  page: async ({ page, authState }, use) => {
    if (authState !== 'logged-out') {
      await page.route('**/api/auth/me', (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: meBody(authState),
        }),
      );

      await page.route('**/api/auth/clinic-identity', (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: CLINIC_IDENTITY_BODY,
        }),
      );

      // The connection-status indicator polls /health/ready every 30s.
      // Pre-mock as healthy so authenticated pages don't spam the dev
      // server with 404s for the duration of every test.
      await page.route('**/health/ready', (route: Route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        }),
      );
    }
    await use(page);
  },
});

export { expect } from '@playwright/test';
