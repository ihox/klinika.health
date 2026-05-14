import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * E2E for the receptionist calendar.
 *
 * The API is fully mocked at the route layer so the test runs without
 * a live NestJS. The appointments integration spec
 * (apps/api/src/modules/appointments/appointments.integration.spec.ts)
 * exercises the actual server.
 *
 * Coverage:
 *   1. Initial render: greeting, stats, calendar grid
 *   2. Marking an appointment as "kryer" updates its visual state
 *   3. The end-of-day prompt appears for yesterday's unmarked
 *      appointments and disappears after marking
 */

const TODAY_ISO = '2026-05-14';
const TOMORROW_ISO = '2026-05-15';
const YESTERDAY_ISO = '2026-05-13';

const SCHEDULED_TIME_LOCAL = '11:00';
const SCHEDULED_UTC = '2026-05-14T09:00:00.000Z'; // 11:00 Europe/Belgrade in May = UTC+2

const HOURS_CONFIG = {
  timezone: 'Europe/Belgrade' as const,
  days: {
    mon: { open: true as const, start: '10:00', end: '18:00' },
    tue: { open: true as const, start: '10:00', end: '18:00' },
    wed: { open: true as const, start: '10:00', end: '18:00' },
    thu: { open: true as const, start: '10:00', end: '18:00' },
    fri: { open: true as const, start: '10:00', end: '18:00' },
    sat: { open: true as const, start: '10:00', end: '14:00' },
    sun: { open: false as const },
  },
  durations: [10, 15, 20, 30, 45],
  defaultDuration: 15,
};

interface StoredAppointment {
  id: string;
  patientId: string;
  patient: { firstName: string; lastName: string; dateOfBirth: string | null };
  scheduledFor: string;
  durationMinutes: number;
  status: 'scheduled' | 'completed' | 'no_show' | 'cancelled';
  lastVisitAt: string | null;
  isNewPatient: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MockState {
  current: StoredAppointment[];
  yesterdayUnmarked: StoredAppointment[];
  patches: Array<{ id: string; body: Record<string, unknown> }>;
}

async function mockApi(page: Page, state: MockState): Promise<void> {
  // Freeze the browser clock to a known instant inside the open window.
  await page.addInitScript(() => {
    const fixed = new Date('2026-05-14T08:50:00.000Z').getTime(); // 10:50 Belgrade
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const RealDate = Date as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).Date = class extends RealDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) {
          super(fixed);
          return;
        }
        super(...(args as []));
      }
      static now(): number {
        return fixed;
      }
    };
  });

  // Block the SSE stream — the EventSource fallback is fine for the
  // test and we don't want a hanging connection.
  await page.route('**/api/appointments/stream', (route: Route) =>
    route.fulfill({ status: 204, body: '' }),
  );

  await page.route('**/api/clinic/settings', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        general: {
          name: 'DonetaMED',
          shortName: 'DonetaMED',
          subdomain: 'donetamed',
          address: 'rr. Test',
          city: 'Prizren',
          phones: ['045 83 00 83'],
          email: 'info@donetamed.health',
        },
        branding: { hasLogo: false, logoContentType: null, hasSignature: false },
        hours: HOURS_CONFIG,
        paymentCodes: { E: { label: 'Falas', amountCents: 0 } },
        email: { mode: 'default', smtp: null },
      }),
    }),
  );

  await page.route('**/api/appointments?**', async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/api/appointments') && route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          appointments: state.current,
          serverTime: new Date().toISOString(),
        }),
      });
    }
    return route.fallback();
  });

  await page.route('**/api/appointments/stats**', (route: Route) => {
    const onDay = state.current;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: TODAY_ISO,
        total: onDay.length,
        scheduled: onDay.filter((a) => a.status === 'scheduled').length,
        completed: onDay.filter((a) => a.status === 'completed').length,
        noShow: onDay.filter((a) => a.status === 'no_show').length,
        cancelled: onDay.filter((a) => a.status === 'cancelled').length,
        firstStart: onDay[0]?.scheduledFor ?? null,
        lastEnd: onDay[onDay.length - 1]?.scheduledFor ?? null,
        nextAppointment:
          onDay.find((a) => a.status === 'scheduled') != null
            ? {
                id: onDay[0]!.id,
                scheduledFor: onDay[0]!.scheduledFor,
                durationMinutes: onDay[0]!.durationMinutes,
                patient: onDay[0]!.patient,
              }
            : null,
      }),
    });
  });

  await page.route('**/api/appointments/unmarked-past', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ appointments: state.yesterdayUnmarked }),
    }),
  );

  await page.route(/\/api\/appointments\/[\w-]+(?:\?.*)?$/, async (route: Route) => {
    const method = route.request().method();
    const match = /\/api\/appointments\/([\w-]+)/.exec(new URL(route.request().url()).pathname);
    if (!match) return route.fallback();
    const id = match[1]!;
    if (method === 'PATCH') {
      const body = (await route.request().postDataJSON()) as Record<string, unknown>;
      state.patches.push({ id, body });
      const target =
        state.current.find((a) => a.id === id) ??
        state.yesterdayUnmarked.find((a) => a.id === id);
      if (!target) return route.fulfill({ status: 404, body: '' });
      if (typeof body.status === 'string') {
        target.status = body.status as StoredAppointment['status'];
      }
      // Once marked, drop from the "unmarked-past" list.
      state.yesterdayUnmarked = state.yesterdayUnmarked.filter((a) => a.id !== id);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ appointment: target }),
      });
    }
    return route.fallback();
  });
}

test.describe('Receptionist calendar', () => {
  test('initial render shows greeting, stats card, and appointment card', async ({ page }) => {
    const state: MockState = {
      current: [
        {
          id: 'a-1',
          patientId: 'p-era',
          patient: {
            firstName: 'Era',
            lastName: 'Krasniqi',
            dateOfBirth: '2023-08-03',
          },
          scheduledFor: SCHEDULED_UTC,
          durationMinutes: 15,
          status: 'scheduled',
          lastVisitAt: '2026-04-01',
          isNewPatient: false,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
        },
      ],
      yesterdayUnmarked: [],
      patches: [],
    };
    await mockApi(page, state);
    await page.goto('/receptionist');

    await expect(page.getByRole('heading', { name: 'Mirëdita.' })).toBeVisible();
    await expect(page.getByText('Termini i ardhshëm', { exact: false })).toBeVisible();
    await expect(page.getByText('Era Krasniqi').first()).toBeVisible();
    await expect(page.getByText('Sot', { exact: false }).first()).toBeVisible();
  });

  test('marking an appointment as kryer updates its visual state', async ({ page }) => {
    const state: MockState = {
      current: [
        {
          id: 'a-1',
          patientId: 'p-era',
          patient: {
            firstName: 'Era',
            lastName: 'Krasniqi',
            dateOfBirth: '2023-08-03',
          },
          scheduledFor: SCHEDULED_UTC,
          durationMinutes: 15,
          status: 'scheduled',
          lastVisitAt: null,
          isNewPatient: true,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
        },
      ],
      yesterdayUnmarked: [],
      patches: [],
    };
    await mockApi(page, state);
    await page.goto('/receptionist');

    const card = page.locator('[data-appt="a-1"]');
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute('data-status', 'scheduled');
    await card.click();

    await page.getByRole('menuitem', { name: 'Shëno si kryer' }).click();
    await expect(card).toHaveAttribute('data-status', 'completed');
    expect(state.patches).toHaveLength(1);
    expect(state.patches[0]).toEqual({ id: 'a-1', body: { status: 'completed' } });
  });

  test('end-of-day prompt appears for yesterdays unmarked appointments and clears once marked', async ({
    page,
  }) => {
    const stale: StoredAppointment = {
      id: 'a-stale',
      patientId: 'p-era',
      patient: { firstName: 'Era', lastName: 'Krasniqi', dateOfBirth: '2023-08-03' },
      // 2026-05-13 10:00 Europe/Belgrade = UTC 08:00
      scheduledFor: '2026-05-13T08:00:00.000Z',
      durationMinutes: 15,
      status: 'scheduled',
      lastVisitAt: null,
      isNewPatient: true,
      createdAt: '2026-05-13T10:00:00.000Z',
      updatedAt: '2026-05-13T10:00:00.000Z',
    };
    const state: MockState = {
      current: [],
      yesterdayUnmarked: [stale],
      patches: [],
    };
    await mockApi(page, state);
    await page.goto('/receptionist');

    await expect(
      page.getByText(/termin i djeshëm është pa status|termine të djeshme janë pa status/),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Shëno status' }).click();
    await page.getByRole('button', { name: 'Kryer' }).first().click();
    expect(state.patches).toHaveLength(1);
    expect(state.patches[0]?.body).toEqual({ status: 'completed' });

    // The page refetches unmarked-past after the patch — the prompt is
    // gone in the next render cycle.
    await expect(
      page.getByText(/termin i djeshëm është pa status|termine të djeshme janë pa status/),
    ).toHaveCount(0);
  });
});

// Reference the unused vars so eslint --noUnusedParameters does not bark
// when the suite stays focused on real interactions instead of the
// constants.
export const _DAYS = [TODAY_ISO, TOMORROW_ISO, YESTERDAY_ISO, SCHEDULED_TIME_LOCAL];
