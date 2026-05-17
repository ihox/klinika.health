import { type Page, type Route } from '@playwright/test';

import { expect, test } from './fixtures/auth';

test.use({ authState: 'receptionist' });

/**
 * E2E for the receptionist calendar.
 *
 * The API is fully mocked at the route layer so the test runs without
 * a live NestJS. The visits-calendar integration spec
 * (apps/api/src/modules/visits/visits-calendar.integration.spec.ts)
 * exercises the actual server.
 *
 * Endpoints mocked here mirror the unified visits surface introduced by
 * ADR-011 (appointments → visits). The legacy `/api/appointments/*`
 * paths are gone from the receptionist UI — every call now goes through
 * `calendarClient` in apps/web/lib/visits-calendar-client.ts.
 *
 * Coverage:
 *   1. Initial render: greeting, stats, calendar grid
 *   2. Marking an in-progress visit as "kryer" updates its visual state
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

type MockStatus = 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'no_show';

interface MockEntry {
  id: string;
  patientId: string;
  patient: { firstName: string; lastName: string; dateOfBirth: string | null };
  scheduledFor: string | null;
  durationMinutes: number | null;
  arrivedAt: string | null;
  status: MockStatus;
  isWalkIn: boolean;
  paymentCode: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  lastVisitAt: string | null;
  isNewPatient: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MockState {
  current: MockEntry[];
  yesterdayUnmarked: MockEntry[];
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
  await page.route('**/api/visits/calendar/stream', (route: Route) =>
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

  // GET /api/visits/calendar?from=...&to=... — entries for a date range.
  // Registered first so the more specific `/stats` and `/unmarked-past`
  // routes below win via Playwright's LIFO route matching.
  await page.route('**/api/visits/calendar?**', async (route: Route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith('/api/visits/calendar') &&
      route.request().method() === 'GET'
    ) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          entries: state.current,
          serverTime: new Date().toISOString(),
        }),
      });
    }
    return route.fallback();
  });

  // GET /api/visits/calendar/stats?date=...
  await page.route('**/api/visits/calendar/stats**', (route: Route) => {
    const onDay = state.current;
    const firstScheduled = onDay.find((a) => a.status === 'scheduled');
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: TODAY_ISO,
        total: onDay.length,
        scheduled: onDay.filter((a) => a.status === 'scheduled').length,
        walkIn: onDay.filter((a) => a.isWalkIn).length,
        standaloneCount: 0,
        completed: onDay.filter((a) => a.status === 'completed').length,
        noShow: onDay.filter((a) => a.status === 'no_show').length,
        arrived: onDay.filter((a) => a.status === 'arrived').length,
        inProgress: onDay.filter((a) => a.status === 'in_progress').length,
        firstStart: onDay[0]?.scheduledFor ?? null,
        lastEnd: onDay[onDay.length - 1]?.scheduledFor ?? null,
        paymentTotalCents: 0,
        nextAppointment:
          firstScheduled && firstScheduled.scheduledFor && firstScheduled.durationMinutes != null
            ? {
                id: firstScheduled.id,
                scheduledFor: firstScheduled.scheduledFor,
                durationMinutes: firstScheduled.durationMinutes,
                patient: firstScheduled.patient,
              }
            : null,
      }),
    });
  });

  // GET /api/visits/calendar/unmarked-past
  await page.route('**/api/visits/calendar/unmarked-past', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: state.yesterdayUnmarked }),
    }),
  );

  // PATCH /api/visits/:id/status — status-only transitions used by
  // both the per-entry action menu and the end-of-day prompt.
  await page.route(/\/api\/visits\/[\w-]+\/status(?:\?.*)?$/, async (route: Route) => {
    const method = route.request().method();
    const match = /\/api\/visits\/([\w-]+)\/status/.exec(
      new URL(route.request().url()).pathname,
    );
    if (!match) return route.fallback();
    const id = match[1]!;
    if (method !== 'PATCH') return route.fallback();
    const body = (await route.request().postDataJSON()) as Record<string, unknown>;
    state.patches.push({ id, body });
    const target =
      state.current.find((a) => a.id === id) ??
      state.yesterdayUnmarked.find((a) => a.id === id);
    if (!target) return route.fulfill({ status: 404, body: '' });
    if (typeof body.status === 'string') {
      target.status = body.status as MockStatus;
    }
    // Once marked, drop from the "unmarked-past" list.
    state.yesterdayUnmarked = state.yesterdayUnmarked.filter((a) => a.id !== id);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entry: target }),
    });
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
          arrivedAt: null,
          status: 'scheduled',
          isWalkIn: false,
          paymentCode: null,
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
    // The unified lifecycle (ADR-011) restricts the receptionist menu's
    // direct path to `completed` to entries already in `in_progress`
    // (see ALLOWED_TRANSITIONS in apps/web/lib/visits-calendar-client.ts).
    // Earlier states reach `completed` via arrived → in_progress → completed.
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
          arrivedAt: SCHEDULED_UTC,
          status: 'in_progress',
          isWalkIn: false,
          paymentCode: null,
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
    await expect(card).toHaveAttribute('data-status', 'in_progress');
    await card.click();

    await page.getByRole('menuitem', { name: 'Shëno si kryer' }).click();
    await expect(card).toHaveAttribute('data-status', 'completed');
    expect(state.patches).toHaveLength(1);
    expect(state.patches[0]).toEqual({ id: 'a-1', body: { status: 'completed' } });
  });

  // Test 3 runs under a doctor session because commit 8720a5c hides the
  // `Shëno status` dropdown for receptionist-only sessions (the lock UI
  // mirrors the server's edit-lock — yesterday's transitions 403 on the
  // receptionist path). The flow we verify here — banner → mark → banner
  // clears — still exists in production, just for doctor / clinic_admin
  // sessions. Coverage for the receptionist-locked variant is tracked in
  // docs/backlog.md.
  test.describe('end-of-day prompt (doctor session)', () => {
    test.use({ authState: 'doctor' });

    test('end-of-day prompt appears for yesterdays unmarked appointments and clears once marked', async ({
      page,
    }) => {
      const stale: MockEntry = {
        id: 'a-stale',
        patientId: 'p-era',
        patient: { firstName: 'Era', lastName: 'Krasniqi', dateOfBirth: '2023-08-03' },
        // 2026-05-13 10:00 Europe/Belgrade = UTC 08:00
        scheduledFor: '2026-05-13T08:00:00.000Z',
        durationMinutes: 15,
        arrivedAt: null,
        status: 'scheduled',
        isWalkIn: false,
        paymentCode: null,
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
});

// Reference the unused vars so eslint --noUnusedParameters does not bark
// when the suite stays focused on real interactions instead of the
// constants.
export const _DAYS = [TODAY_ISO, TOMORROW_ISO, YESTERDAY_ISO, SCHEDULED_TIME_LOCAL];
