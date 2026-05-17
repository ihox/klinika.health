import { type Page, type Route } from '@playwright/test';

import { expect, test } from './fixtures/auth';

test.use({ authState: 'receptionist' });

/**
 * E2E for the slice-09 booking flows. Both Path 1 (slot-first) and
 * Path 2 (patient-first) plus edit-existing and the three conflict
 * states (clean fit, auto-extend, blocked).
 *
 * Endpoints mocked here mirror the unified visits surface introduced
 * by ADR-011 (appointments → visits). The receptionist UI now calls
 * `/api/visits/calendar/*` for reads and `/api/visits/{scheduled,
 * :id/scheduling, :id/status, calendar/:id}` for writes. The legacy
 * `/api/appointments/*` paths are gone.
 *
 * The visits-calendar integration spec
 * (apps/api/src/modules/visits/visits-calendar.integration.spec.ts)
 * covers the live wire-up against Postgres.
 */

const TODAY_ISO = '2026-05-14'; // Thursday
const TODAY_TIMESTAMP = '2026-05-14T08:50:00.000Z'; // 10:50 Belgrade

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
  durations: [10, 15, 20, 30],
  defaultDuration: 15,
};

const SAMPLE_PATIENTS = [
  { id: 'p-rita', firstName: 'Rita', lastName: 'Hoxha', dateOfBirth: '2024-02-12' },
  { id: 'p-dion', firstName: 'Dion', lastName: 'Hoxha', dateOfBirth: '2019-01-15' },
];

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

interface AvailabilityScript {
  /** Override which durations should block for the next availability call. */
  blockedDurations?: number[];
  /** Which durations should report "extends" instead of "fits". */
  extendsDurations?: number[];
}

interface MockState {
  current: MockEntry[];
  posts: Array<Record<string, unknown>>;
  patches: Array<{ id: string; body: Record<string, unknown> }>;
  deletes: string[];
  patientCreates: Array<Record<string, unknown>>;
  /** Per-call override for the next availability fetch. */
  nextAvailability: AvailabilityScript;
}

function newState(initial: MockEntry[] = []): MockState {
  return {
    current: initial,
    posts: [],
    patches: [],
    deletes: [],
    patientCreates: [],
    nextAvailability: {},
  };
}

async function mockApi(page: Page, state: MockState): Promise<void> {
  // Freeze the browser clock to a deterministic open weekday.
  await page.addInitScript(() => {
    const fixed = new Date('2026-05-14T08:50:00.000Z').getTime();
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
  // Registered before the more specific stats/unmarked-past/availability
  // routes so LIFO matches them first.
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

  await page.route('**/api/visits/calendar/stats**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: TODAY_ISO,
        total: state.current.length,
        scheduled: state.current.filter((a) => a.status === 'scheduled').length,
        walkIn: state.current.filter((a) => a.isWalkIn).length,
        standaloneCount: 0,
        completed: state.current.filter((a) => a.status === 'completed').length,
        noShow: state.current.filter((a) => a.status === 'no_show').length,
        arrived: state.current.filter((a) => a.status === 'arrived').length,
        inProgress: state.current.filter((a) => a.status === 'in_progress').length,
        firstStart: state.current[0]?.scheduledFor ?? null,
        lastEnd: state.current[state.current.length - 1]?.scheduledFor ?? null,
        paymentTotalCents: 0,
        nextAppointment: null,
      }),
    }),
  );

  await page.route('**/api/visits/calendar/unmarked-past', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [] }),
    }),
  );

  await page.route('**/api/visits/calendar/availability**', (route: Route) => {
    const url = new URL(route.request().url());
    const time = url.searchParams.get('time') ?? '10:30';
    const date = url.searchParams.get('date') ?? TODAY_ISO;
    const sorted = HOURS_CONFIG.durations.slice().sort((a, b) => a - b);
    const slotUnit = sorted[0]!;
    const blocked = new Set(state.nextAvailability.blockedDurations ?? []);
    const extendsOverride = new Set(state.nextAvailability.extendsDurations ?? []);
    const options = sorted.map((d) => {
      if (blocked.has(d)) {
        return { durationMinutes: d, status: 'blocked', endsAt: null, reason: 'conflict' };
      }
      const naturalStatus = d > slotUnit ? 'extends' : 'fits';
      const status = extendsOverride.has(d) ? 'extends' : naturalStatus;
      const [hh, mm] = time.split(':').map(Number) as [number, number];
      const endMin = hh * 60 + mm + d;
      const endsAt = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
      return { durationMinutes: d, status, endsAt, reason: null };
    });
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ date, time, slotUnitMinutes: slotUnit, options }),
    });
  });

  // POST /api/visits/scheduled — create a booking.
  await page.route('**/api/visits/scheduled', async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = (await route.request().postDataJSON()) as Record<string, unknown>;
    state.posts.push(body);
    const id = `apt-${state.posts.length}`;
    const date = String(body.date);
    const time = String(body.time);
    // 2026-05 in Belgrade is UTC+2 (CEST). Build the UTC ISO instant.
    const utcOffsetMin = -120;
    const utcDate = new Date(`${date}T${time}:00.000Z`);
    utcDate.setMinutes(utcDate.getMinutes() + utcOffsetMin);
    const patient =
      SAMPLE_PATIENTS.find((p) => p.id === body.patientId) ?? SAMPLE_PATIENTS[0]!;
    const apt: MockEntry = {
      id,
      patientId: String(body.patientId),
      patient: {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: patient.dateOfBirth,
      },
      scheduledFor: utcDate.toISOString(),
      durationMinutes: Number(body.durationMinutes),
      arrivedAt: null,
      status: 'scheduled',
      isWalkIn: false,
      paymentCode: null,
      lastVisitAt: null,
      isNewPatient: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.current.push(apt);
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ entry: apt }),
    });
  });

  // PATCH /api/visits/:id/scheduling — reschedule date/time/duration.
  await page.route(/\/api\/visits\/[\w-]+\/scheduling(?:\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const match = /\/api\/visits\/([\w-]+)\/scheduling/.exec(
      new URL(route.request().url()).pathname,
    );
    if (!match) return route.fallback();
    const id = match[1]!;
    const body = (await route.request().postDataJSON()) as Record<string, unknown>;
    state.patches.push({ id, body });
    const apt = state.current.find((a) => a.id === id);
    if (!apt) return route.fulfill({ status: 404, body: '' });
    if (typeof body.durationMinutes === 'number') {
      apt.durationMinutes = body.durationMinutes;
    }
    if (typeof body.date === 'string' && typeof body.time === 'string') {
      const utcOffsetMin = -120;
      const utcDate = new Date(`${body.date}T${body.time}:00.000Z`);
      utcDate.setMinutes(utcDate.getMinutes() + utcOffsetMin);
      apt.scheduledFor = utcDate.toISOString();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entry: apt }),
    });
  });

  // PATCH /api/visits/:id/status — status-only transition.
  await page.route(/\/api\/visits\/[\w-]+\/status(?:\?.*)?$/, async (route: Route) => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    const match = /\/api\/visits\/([\w-]+)\/status/.exec(
      new URL(route.request().url()).pathname,
    );
    if (!match) return route.fallback();
    const id = match[1]!;
    const body = (await route.request().postDataJSON()) as Record<string, unknown>;
    state.patches.push({ id, body });
    const apt = state.current.find((a) => a.id === id);
    if (!apt) return route.fulfill({ status: 404, body: '' });
    if (typeof body.status === 'string') {
      apt.status = body.status as MockStatus;
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entry: apt }),
    });
  });

  // DELETE /api/visits/calendar/:id — soft-delete.
  // POST   /api/visits/calendar/:id/restore — restore within window.
  await page.route(
    /\/api\/visits\/calendar\/[\w-]+(?:\/restore)?(?:\?.*)?$/,
    async (route: Route) => {
      const url = new URL(route.request().url());
      const idMatch = /\/api\/visits\/calendar\/([\w-]+)(\/restore)?$/.exec(url.pathname);
      if (!idMatch) return route.fallback();
      const id = idMatch[1]!;
      const isRestore = idMatch[2] === '/restore';
      const method = route.request().method();
      if (method === 'DELETE' && !isRestore) {
        state.deletes.push(id);
        state.current = state.current.filter((a) => a.id !== id);
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            status: 'ok',
            restorableUntil: new Date(Date.now() + 30_000).toISOString(),
          }),
        });
      }
      if (method === 'POST' && isRestore) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ entry: state.current[0] ?? null }),
        });
      }
      return route.fallback();
    },
  );

  // Patient search + create
  await page.route('**/api/patients**', async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'GET' && /\/api\/patients$/.test(url.pathname)) {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const matches = q
        ? SAMPLE_PATIENTS.filter(
            (p) =>
              p.firstName.toLowerCase().includes(q) ||
              p.lastName.toLowerCase().includes(q),
          )
        : SAMPLE_PATIENTS;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ patients: matches }),
      });
    }
    if (method === 'POST' && /\/api\/patients$/.test(url.pathname)) {
      const body = (await route.request().postDataJSON()) as Record<string, unknown>;
      state.patientCreates.push(body);
      const created = {
        id: `p-new-${state.patientCreates.length}`,
        firstName: String(body.firstName),
        lastName: String(body.lastName),
        dateOfBirth: body.dateOfBirth ? String(body.dateOfBirth) : null,
      };
      SAMPLE_PATIENTS.push({
        ...created,
        dateOfBirth: created.dateOfBirth ?? '2020-01-01',
      });
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ patient: created }),
      });
    }
    if (method === 'POST' && url.pathname.endsWith('/duplicate-check')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates: [] }),
      });
    }
    return route.fallback();
  });
}

// ---------------------------------------------------------------------------
// Path 2 — patient-first booking (most deterministic to drive in tests)
// ---------------------------------------------------------------------------

test.describe('Booking dialog', () => {
  test('Path 2: global search → existing patient → booking with explicit time + duration', async ({
    page,
  }) => {
    const state = newState();
    await mockApi(page, state);
    await page.goto('/receptionist');

    await page.getByRole('textbox', { name: 'Kërko pacient' }).click();
    await page.getByRole('textbox', { name: 'Kërko pacient' }).fill('Rita');
    await page.getByRole('option', { name: /Rita Hoxha/ }).click();

    await expect(page.getByRole('heading', { name: 'Cakto termin' })).toBeVisible();

    // Patient panel renders the chosen patient.
    await expect(page.getByText('Rita Hoxha').first()).toBeVisible();

    // [Cakto termin] is disabled because time is empty.
    const submit = page.getByRole('button', { name: 'Cakto termin' });
    await expect(submit).toBeDisabled();

    // Pick a time, then a duration.
    await page.getByLabel('Ora').selectOption('11:00');
    // Wait for availability to settle (button still disabled until duration).
    await expect(submit).toBeDisabled();
    await page.getByRole('button', { name: /^10\s*min/ }).click();
    await expect(submit).toBeEnabled();
    await submit.click();

    // Toast confirms with date + time + duration.
    await expect(page.getByText(/Termini u caktua për/)).toBeVisible();
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]).toMatchObject({
      patientId: 'p-rita',
      date: TODAY_ISO,
      time: '11:00',
      durationMinutes: 10,
    });
  });

  test('Path 2: auto-extend notice surfaces when duration > slot unit', async ({ page }) => {
    const state = newState();
    state.nextAvailability = { extendsDurations: [15] };
    await mockApi(page, state);
    await page.goto('/receptionist');

    await page.getByRole('textbox', { name: 'Kërko pacient' }).click();
    await page.getByRole('textbox', { name: 'Kërko pacient' }).fill('Rita');
    await page.getByRole('option', { name: /Rita Hoxha/ }).click();
    await page.getByLabel('Ora').selectOption('11:00');
    await page.getByRole('button', { name: /^15\s*min/ }).click();

    await expect(
      page.getByText(/Ky termin do të zgjasë deri/),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cakto termin' })).toBeEnabled();
  });

  test('Path 2: blocked duration is disabled and warning visible', async ({ page }) => {
    const state = newState();
    state.nextAvailability = { blockedDurations: [15, 20, 30] };
    await mockApi(page, state);
    await page.goto('/receptionist');

    await page.getByRole('textbox', { name: 'Kërko pacient' }).click();
    await page.getByRole('textbox', { name: 'Kërko pacient' }).fill('Rita');
    await page.getByRole('option', { name: /Rita Hoxha/ }).click();
    await page.getByLabel('Ora').selectOption('12:30');

    // The 15-min option is disabled (aria-disabled='true').
    const fifteen = page.getByRole('button', { name: /^15\s*min/ });
    await expect(fifteen).toBeDisabled();

    // Inline warning is visible.
    await expect(
      page.getByText(/Kjo kohëzgjatje nuk është e disponueshme/),
    ).toBeVisible();

    // 10 min still works.
    await page.getByRole('button', { name: /^10\s*min/ }).click();
    await expect(page.getByRole('button', { name: 'Cakto termin' })).toBeEnabled();
  });

  test('Path 2: quick-add → returns to booking with new patient pre-selected', async ({
    page,
  }) => {
    const state = newState();
    await mockApi(page, state);
    await page.goto('/receptionist');

    await page.getByRole('textbox', { name: 'Kërko pacient' }).click();
    await page.getByRole('textbox', { name: 'Kërko pacient' }).fill('Erblire Smith');
    await page.getByRole('button', { name: /Shto pacient të ri/ }).click();

    await expect(page.getByRole('heading', { name: 'Pacient i ri' })).toBeVisible();
    // Quick-add modal pre-fills the names from the seed.
    await expect(page.getByLabel('Emri')).toHaveValue('Erblire');
    await expect(page.getByLabel('Mbiemri')).toHaveValue('Smith');

    await page.getByRole('button', { name: 'Ruaj pacientin' }).click();

    // Quick-add closes, booking dialog opens with the new patient.
    await expect(page.getByRole('heading', { name: 'Cakto termin' })).toBeVisible();
    await expect(page.getByText('Erblire Smith').first()).toBeVisible();
  });

  test('Path 1: slot click → patient picker → quick-add → booking → toast', async ({
    page,
  }) => {
    const state = newState();
    await mockApi(page, state);
    await page.goto('/receptionist');

    // The 10-min slot snap means clicking near the top of any open
    // column lands at 10:00. We grab today's column (it gets the
    // teal-tinted background) by looking up by aria-label.
    const todayCol = page.locator('[role="grid"]').first();
    await todayCol.click({ position: { x: 30, y: 60 } });

    // Picker popover opened, anchored to the click coords.
    await expect(page.getByRole('dialog', { name: /Cakto për/ })).toBeVisible();

    // Type a query that doesn't match any existing patient, then add new.
    await page.getByPlaceholder('Kërko pacient...').fill('Linda Berisha');
    await page.getByText(/Shto pacient të ri/).click();

    // Quick-add prefilled with the typed name.
    await expect(page.getByRole('heading', { name: 'Pacient i ri' })).toBeVisible();
    await expect(page.getByLabel('Emri')).toHaveValue('Linda');
    await page.getByRole('button', { name: 'Ruaj pacientin' }).click();

    // Booking dialog opens — time should be pre-filled from the slot.
    await expect(page.getByRole('heading', { name: 'Cakto termin' })).toBeVisible();
    // Time is set to whatever the slot snap chose (within the open band).
    await expect(page.getByLabel('Ora')).not.toHaveValue('');

    // Pick a duration and submit.
    await page.getByRole('button', { name: /^10\s*min/ }).click();
    await page.getByRole('button', { name: 'Cakto termin' }).click();

    await expect(page.getByText(/Termini u caktua për/)).toBeVisible();
    expect(state.posts).toHaveLength(1);
    expect(state.patientCreates).toHaveLength(1);
  });

  test('Edit existing appointment: opens dialog in edit mode, PATCH on save', async ({
    page,
  }) => {
    // 11:00 Belgrade = 09:00 UTC in May (UTC+2).
    const initial: MockEntry = {
      id: 'apt-existing',
      patientId: 'p-rita',
      patient: { firstName: 'Rita', lastName: 'Hoxha', dateOfBirth: '2024-02-12' },
      scheduledFor: '2026-05-14T09:00:00.000Z',
      durationMinutes: 15,
      arrivedAt: null,
      status: 'scheduled',
      isWalkIn: false,
      paymentCode: null,
      lastVisitAt: null,
      isNewPatient: true,
      createdAt: '2026-05-01T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
    };
    const state = newState([initial]);
    await mockApi(page, state);
    await page.goto('/receptionist');

    await page.locator('[data-appt="apt-existing"]').click();
    await page.getByRole('menuitem', { name: 'Riprogramo terminin' }).click();

    await expect(page.getByRole('heading', { name: 'Riprogramo terminin' })).toBeVisible();
    // Pre-filled with current values.
    await expect(page.getByLabel('Ora')).toHaveValue('11:00');

    // Change duration to 20 min and save.
    await page.getByRole('button', { name: /^20\s*min/ }).click();
    await page.getByRole('button', { name: 'Ruaj ndryshimet' }).click();

    await expect(page.getByText(/Termini u zhvendos në/)).toBeVisible();
    expect(state.patches).toHaveLength(1);
    expect(state.patches[0]!.body).toMatchObject({ durationMinutes: 20 });
  });
});

// Reference unused constants so eslint --noUnusedLocals doesn't bark.
export const _TODAY_TIMESTAMP = TODAY_TIMESTAMP;
