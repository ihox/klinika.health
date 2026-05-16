import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * E2E for the doctor dashboard's top-nav GLOBAL patient search — the
 * new clinic-wide search next to the doctor's profile chip. Distinct
 * from the in-panel "Terminet e sotit" filter (covered by
 * `doctor-home.spec.ts`), which only narrows today's appointment list.
 *
 * Coverage:
 *   - Input visible with ⌘K / Ctrl+K hint
 *   - Panel-search placeholder is the new "Kërko pacientin në listë"
 *   - Typing shows a dropdown of matching patients
 *   - Empty-result state renders the Albanian no-match message
 *   - Enter on a highlighted row navigates to /pacient/:id
 *   - ⌘K / Ctrl+K focuses the input from anywhere on the page
 *   - Escape closes the dropdown
 */

const FIXED_INSTANT_ISO = '2026-05-14T11:30:00.000Z';

interface PatientFullDtoLike {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  sex: 'm' | 'f' | null;
}

const ALL_PATIENTS: PatientFullDtoLike[] = [
  {
    id: 'p-era',
    firstName: 'Era',
    lastName: 'Krasniqi',
    dateOfBirth: '2023-08-03',
    sex: 'f',
  },
  {
    id: 'p-era-2',
    firstName: 'Era',
    lastName: 'Berisha',
    dateOfBirth: '2022-03-12',
    sex: 'f',
  },
  {
    id: 'p-erblir',
    firstName: 'Erblir',
    lastName: 'Hoxha',
    dateOfBirth: '2020-01-15',
    sex: 'm',
  },
];

function buildDashboardSnapshot() {
  return {
    date: '2026-05-14',
    serverTime: FIXED_INSTANT_ISO,
    appointments: [],
    todayVisits: [],
    nextPatient: null,
    stats: {
      visitsCompleted: 0,
      appointmentsTotal: 0,
      appointmentsCompleted: 0,
      averageVisitMinutes: null,
      paymentsCents: 0,
    },
  };
}

async function mockApi(page: Page): Promise<void> {
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

  await page.route('**/api/visits/calendar/stream', (route: Route) =>
    route.fulfill({ status: 204, body: '' }),
  );

  await page.route('**/api/doctor/dashboard', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildDashboardSnapshot()),
    }),
  );

  // Patient search: filter by name (case-insensitive substring match
  // on the combined "first last"), capped at 8 like the real endpoint.
  await page.route('**/api/patients?**', (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const matches = q.length === 0
      ? []
      : ALL_PATIENTS.filter((p) =>
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(q),
        ).slice(0, 8);
    const patients = matches.map((p) => ({
      ...p,
      clinicId: 'c-1',
      legacyId: null,
      placeOfBirth: null,
      phone: null,
      birthWeightG: null,
      birthLengthCm: null,
      birthHeadCircumferenceCm: null,
      alergjiTjera: null,
      lastVisitAt: null,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      isComplete: true,
    }));
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ patients }),
    });
  });

  // /pacient/:id needs a /me + chart fetch when the doctor lands on
  // it. The navigateToPatient helper hits GET /api/patients/:id first.
  await page.route('**/api/patients/p-era', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        patient: {
          ...ALL_PATIENTS[0],
          clinicId: 'c-1',
          legacyId: null,
          placeOfBirth: null,
          phone: null,
          birthWeightG: null,
          birthLengthCm: null,
          birthHeadCircumferenceCm: null,
          alergjiTjera: null,
          lastVisitAt: null,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
          isComplete: true,
        },
      }),
    }),
  );
}

test.describe('Doctor — global patient search', () => {
  test('renders the search input with ⌘K / Ctrl+K hint', async ({ page }) => {
    await mockApi(page);
    await page.goto('/doctor');

    const search = page.getByLabel('Kërko pacient në klinikë');
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('placeholder', 'Kërko Pacient');
    // Either ⌘K (Mac runners) or Ctrl+K (Linux CI) is acceptable.
    await expect(page.locator('kbd').first()).toHaveText(/⌘K|Ctrl\+K/);
  });

  test('panel search placeholder is "Kërko pacientin në listë"', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/doctor');
    await expect(
      page.getByPlaceholder('Kërko pacientin në listë'),
    ).toBeVisible();
  });

  test('typing opens a dropdown with matching patients', async ({ page }) => {
    await mockApi(page);
    await page.goto('/doctor');

    await page.getByLabel('Kërko pacient në klinikë').fill('Era');
    const listbox = page.getByRole('listbox', {
      name: 'Rezultatet e kërkimit të pacientëve',
    });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByText('Era Krasniqi')).toBeVisible();
    await expect(listbox.getByText('Era Berisha')).toBeVisible();
  });

  test('shows the empty-result message when no patients match', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/doctor');

    await page
      .getByLabel('Kërko pacient në klinikë')
      .fill('Zzzzzznoonematchesthis');
    await expect(page.getByText('Nuk u gjet asnjë pacient.')).toBeVisible();
  });

  test('Enter on the highlighted row navigates to the patient chart', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/doctor');

    const input = page.getByLabel('Kërko pacient në klinikë');
    await input.fill('Era');
    await expect(page.getByText('Era Krasniqi')).toBeVisible();
    await input.press('Enter');
    await expect(page).toHaveURL(/\/pacient\/p-era(\?.*)?$/);
  });

  test('Escape closes the dropdown', async ({ page }) => {
    await mockApi(page);
    await page.goto('/doctor');

    await page.getByLabel('Kërko pacient në klinikë').fill('Era');
    const listbox = page.getByRole('listbox', {
      name: 'Rezultatet e kërkimit të pacientëve',
    });
    await expect(listbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
  });

  test('Ctrl+K / ⌘K focuses the search input from anywhere on the page', async ({
    page,
  }) => {
    await mockApi(page);
    await page.goto('/doctor');

    // Click somewhere neutral so focus is parked outside the search.
    await page.getByRole('heading', { name: /Mirëdita/ }).click();
    // Playwright's "ControlOrMeta" expands to ⌘ on Mac, Ctrl elsewhere
    // — matches the runtime detection in `apps/web/lib/platform.ts`.
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByLabel('Kërko pacient në klinikë')).toBeFocused();
  });
});
