import { type Page, type Route } from '@playwright/test';

import { expect, test } from './fixtures/auth';

/**
 * E2E for the doctor's "Pamja e ditës" home dashboard (slice 10).
 *
 * The API is fully mocked at the route layer so the test runs without
 * a live NestJS. The dashboard integration spec
 * (apps/api/src/modules/doctor-dashboard/doctor-dashboard.integration.spec.ts)
 * exercises the actual server.
 *
 * Coverage:
 *   1. Time-of-day greeting renders, date subtitle is in Albanian
 *   2. Today's appointment list shows times + patient names + a
 *      highlighted current/next row
 *   3. Day-stats card reflects visits/payments/average
 *   4. Next-patient card shows allergy chip (doctor-only)
 *   5. Completed-visit log entries are listed
 *   6. Click-through: opening a patient chart navigates to the
 *      patients screen with `?patientId=…`
 *   7. Quick-search field filters the visible appointment list
 */

const FIXED_INSTANT_ISO = '2026-05-14T11:30:00.000Z'; // 13:30 Belgrade (Mirëdita)

const CURRENT_UTC = '2026-05-14T11:20:00.000Z'; // 13:20 Belgrade (in progress)
const NEXT_UTC = '2026-05-14T12:10:00.000Z'; // 14:10 Belgrade (upcoming)
const PAST_UTC = '2026-05-14T08:00:00.000Z'; // 10:00 Belgrade (done)

function buildSnapshot() {
  return {
    date: '2026-05-14',
    serverTime: FIXED_INSTANT_ISO,
    appointments: [
      {
        id: 'apt-past',
        patientId: 'p-era',
        patient: {
          firstName: 'Era',
          lastName: 'Berisha',
          dateOfBirth: '2022-03-12',
        },
        scheduledFor: PAST_UTC,
        durationMinutes: 15,
        status: 'completed' as const,
        position: 'past' as const,
      },
      {
        id: 'apt-current',
        patientId: 'p-current',
        patient: {
          firstName: 'Era',
          lastName: 'Krasniqi',
          dateOfBirth: '2023-08-03',
        },
        scheduledFor: CURRENT_UTC,
        durationMinutes: 20,
        status: 'scheduled' as const,
        position: 'current' as const,
      },
      {
        id: 'apt-next',
        patientId: 'p-mira',
        patient: {
          firstName: 'Mira',
          lastName: 'Hoxhaj',
          dateOfBirth: '2025-06-14',
        },
        scheduledFor: NEXT_UTC,
        durationMinutes: 15,
        status: 'scheduled' as const,
        position: 'next' as const,
      },
    ],
    todayVisits: [
      {
        id: 'visit-1',
        patientId: 'p-era',
        patient: {
          firstName: 'Era',
          lastName: 'Berisha',
          dateOfBirth: '2022-03-12',
        },
        recordedAt: '2026-05-14T08:10:00.000Z',
        primaryDiagnosis: {
          code: 'J03.9',
          latinDescription: 'Tonsillitis acuta',
        },
        paymentCode: 'A',
        paymentAmountCents: 1500,
      },
    ],
    nextPatient: {
      appointmentId: 'apt-current',
      patientId: 'p-current',
      patient: {
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'f' as const,
      },
      scheduledFor: CURRENT_UTC,
      durationMinutes: 20,
      visitCount: 4,
      lastVisitDate: '2026-04-01',
      daysSinceLastVisit: 43,
      lastDiagnosis: {
        code: 'J03.9',
        latinDescription: 'Tonsillitis acuta',
      },
      lastWeightG: 13600,
      hasAllergyNote: true,
    },
    stats: {
      visitsCompleted: 1,
      appointmentsTotal: 3,
      appointmentsCompleted: 1,
      averageVisitMinutes: 12,
      paymentsCents: 1500,
    },
  };
}

async function mockApi(
  page: Page,
  snapshot: ReturnType<typeof buildSnapshot>,
): Promise<void> {
  // Freeze the browser clock so "now" is deterministic for the
  // greeting + "current appointment" highlight.
  await page.addInitScript((iso: string) => {
    const fixed = new Date(iso).getTime();
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
  }, FIXED_INSTANT_ISO);

  // Block the SSE stream; the dashboard polls as fallback.
  await page.route('**/api/visits/calendar/stream', (route: Route) =>
    route.fulfill({ status: 204, body: '' }),
  );

  await page.route('**/api/doctor/dashboard', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(snapshot),
    }),
  );
}

test.describe('Doctor home dashboard', () => {
  test('renders greeting, today, stats, next patient and visits', async ({ page }) => {
    const snapshot = buildSnapshot();
    await mockApi(page, snapshot);
    await page.goto('/doctor');

    // Greeting (13:30 Belgrade → Mirëdita)
    await expect(
      page.getByRole('heading', { name: /Mirëdita/ }),
    ).toBeVisible();
    await expect(
      page.getByText('E enjte, 14 maj 2026', { exact: false }),
    ).toBeVisible();

    // Today's appointments — both highlighted rows visible.
    await expect(page.getByText('Era Krasniqi').first()).toBeVisible();
    await expect(page.getByText('Mira Hoxhaj').first()).toBeVisible();

    // Day stats: visits 1/3, mesatare 12 min, pagesa 15 €. The
    // "Pagesa" tile and the visit log both show "15 €"; scope to the
    // tile by querying via the label. `{completed}` / `{total}` render
    // as adjacent text nodes around an inline `/` span with margin,
    // so textContent is "1/3" without spaces.
    await expect(page.getByText('1/3')).toBeVisible();
    await expect(page.getByText('Mesatare', { exact: true })).toBeVisible();
    await expect(page.getByText('Pagesa', { exact: true })).toBeVisible();
    await expect(page.getByText('15 €').first()).toBeVisible();

    // Next patient: name + allergy chip + visit count.
    await expect(
      page.getByText('Pacienti në vijim', { exact: false }),
    ).toBeVisible();
    await expect(page.getByText('Shih kartelën')).toBeVisible(); // allergy chip
    await expect(page.getByText('43 ditë nga vizita e fundit')).toBeVisible();

    // Completed-visit log row.
    await expect(page.getByText('J03.9 Tonsillitis acuta')).toBeVisible();
    await expect(page.getByText('Era Berisha').first()).toBeVisible();
  });

  test('clicking "Hap kartelën" navigates to the patient chart', async ({ page }) => {
    const snapshot = buildSnapshot();
    await mockApi(page, snapshot);
    await page.goto('/doctor');

    // The "Hap kartelën" click goes through safeNavigateToPatient,
    // which GETs /api/patients/:id and then routes to /pacient/:id
    // (chart) when isComplete=true, else /pacient/:id/te-dhena
    // (master-data form). Both forms come from commit f45b9b4 —
    // the legacy /doctor/pacientet?patientId=X target is gone.
    //
    // The mock pattern is a regex (not a glob) because Playwright's
    // `**/api/patients**` glob curiously does NOT match
    // `/api/patients/:id` — the path segment after `patients/` slips
    // past the trailing `**`. Using a regex sidesteps that.
    await page.route(/\/api\/patients(\/[^/?]+)?(\?.*)?$/, (route: Route) => {
      const url = new URL(route.request().url());
      const m = /\/api\/patients\/([^/]+)$/.exec(url.pathname);
      if (m && route.request().method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            patient: {
              id: m[1],
              firstName: 'Era',
              lastName: 'Krasniqi',
              dateOfBirth: '2023-08-03',
              sex: 'f',
              isComplete: true,
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ patients: [] }),
      });
    });

    await page.getByRole('button', { name: /Hap kartelën/ }).click();
    await expect(page).toHaveURL(/\/pacient\/p-current$/);
  });

  test('quick-search filters the visible appointment list', async ({ page }) => {
    const snapshot = buildSnapshot();
    await mockApi(page, snapshot);
    await page.goto('/doctor');

    await page.getByPlaceholder('Kërko pacientin në listë').fill('Mira');
    // Scope the assertions to the appointments panel — the next-patient
    // card on the right still shows other names, which is expected.
    const apptsPanel = page
      .getByRole('heading', { name: 'Terminet e sotit' })
      .locator('xpath=ancestor::section');
    await expect(apptsPanel.getByText('Mira Hoxhaj')).toBeVisible();
    await expect(apptsPanel.getByText('Era Krasniqi')).toHaveCount(0);
    await expect(apptsPanel.getByText('Era Berisha')).toHaveCount(0);
  });
});
