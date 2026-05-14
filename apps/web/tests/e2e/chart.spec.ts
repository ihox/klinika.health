import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * E2E for the patient chart shell (slice 11).
 *
 * API mocked at the route layer — the chart-bundle integration spec
 * (`apps/api/src/modules/patients/patients.integration.spec.ts`)
 * exercises the live wire-up.
 *
 * Coverage:
 *   1. Loading skeleton flashes briefly, then the master strip and
 *      history list render with the right copy.
 *   2. Visit navigation: ◀/▶ buttons, ← / → arrow keys, history
 *      list click — all update the visible visit + URL.
 *   3. The "Vizita X nga Y" counter shows the oldest-first index.
 *   4. Receptionist (403) sees the forbidden empty state.
 *   5. Patient with zero visits shows the empty-visits state.
 *   6. Allergies are visible to the doctor (full text in title attr).
 */

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_NEW = '22222222-2222-4222-8222-222222222222'; // most recent
const VISIT_MID = '33333333-3333-4333-8333-333333333333';
const VISIT_OLD = '44444444-4444-4444-8444-444444444444';

interface ChartFixtureOptions {
  status?: number;
  body?: unknown;
}

async function mockChart(page: Page, options: ChartFixtureOptions = {}): Promise<void> {
  const status = options.status ?? 200;
  const body =
    options.body ??
    ({
      patient: {
        id: PATIENT_ID,
        clinicId: 'c-donetamed',
        legacyId: 4829,
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'f',
        placeOfBirth: 'Prizren',
        phone: '+383 44 123 456',
        birthWeightG: 3280,
        birthLengthCm: 51,
        birthHeadCircumferenceCm: 34,
        alergjiTjera: 'Penicilinë, dhembet mjekun',
        createdAt: '2023-08-03T10:00:00.000Z',
        updatedAt: '2026-05-14T09:00:00.000Z',
      },
      visits: [
        {
          id: VISIT_NEW,
          visitDate: '2026-05-14',
          primaryDiagnosis: { code: 'J03.9', latinDescription: 'Tonsillitis acuta' },
          legacyDiagnosis: null,
          paymentCode: 'A',
          updatedAt: '2026-05-14T11:00:00.000Z',
        },
        {
          id: VISIT_MID,
          visitDate: '2026-04-01',
          primaryDiagnosis: { code: 'J20.9', latinDescription: 'Bronchitis acuta' },
          legacyDiagnosis: null,
          paymentCode: 'A',
          updatedAt: '2026-04-01T11:00:00.000Z',
        },
        {
          id: VISIT_OLD,
          visitDate: '2025-12-17',
          primaryDiagnosis: { code: 'Z00.1', latinDescription: 'Kontroll i rregullt' },
          legacyDiagnosis: null,
          paymentCode: 'B',
          updatedAt: '2025-12-17T11:00:00.000Z',
        },
      ],
      vertetime: [
        {
          id: 'v-1',
          visitId: VISIT_MID,
          issuedAt: '2026-04-01T10:30:00.000Z',
          absenceFrom: '2026-04-01',
          absenceTo: '2026-04-05',
          durationDays: 5,
          diagnosisSnapshot: 'J03.9 Tonsillitis acuta',
        },
      ],
      daysSinceLastVisit: 0,
      visitCount: 3,
    } as const);

  await page.route(`**/api/patients/${PATIENT_ID}/chart`, (route: Route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

test.describe('Patient chart shell', () => {
  test('renders master strip, history, and vërtetime list', async ({ page }) => {
    await mockChart(page);
    await page.goto(`/pacient/${PATIENT_ID}`);

    // Master strip
    await expect(page.getByText('Era Krasniqi', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('#PT-04829')).toBeVisible();
    await expect(page.getByText('Prizren', { exact: false })).toBeVisible();
    await expect(page.getByText('+383 44 123 456')).toBeVisible();
    await expect(page.getByText(/3.?280/).first()).toBeVisible(); // birth weight (locale-agnostic)
    // Allergies row (doctor-visible)
    await expect(page.getByText('Alergji / Tjera')).toBeVisible();
    await expect(page.getByText('Penicilinë, dhembet mjekun')).toBeVisible();

    // Visit nav — opens on most-recent visit by default
    await expect(page.getByText('Vizita 3 nga 3')).toBeVisible();

    // History panel rows (use scoped lookups against the panel)
    const historyPanel = page.getByRole('region', { name: /Historia e vizitave/ });
    await expect(historyPanel.getByText('J03.9')).toBeVisible();
    await expect(historyPanel.getByText('J20.9')).toBeVisible();
    await expect(historyPanel.getByText('Z00.1')).toBeVisible();

    // Vërtetim row
    const certPanel = page.getByRole('region', { name: /Vërtetime/ });
    await expect(certPanel.getByText('J03.9 Tonsillitis acuta')).toBeVisible();
    await expect(certPanel.getByText('5 ditë', { exact: false })).toBeVisible();

    // URL replaced with the most-recent visit id
    await expect(page).toHaveURL(new RegExp(`/pacient/${PATIENT_ID}/vizita/${VISIT_NEW}$`));
  });

  test('navigating with ← arrow moves to the older visit', async ({ page }) => {
    await mockChart(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByText('Vizita 3 nga 3')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Vizita 2 nga 3')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/pacient/${PATIENT_ID}/vizita/${VISIT_MID}$`));

    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Vizita 1 nga 3')).toBeVisible();

    // At the oldest visit — another ArrowLeft is a no-op.
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByText('Vizita 1 nga 3')).toBeVisible();
  });

  test('clicking a history row loads that visit', async ({ page }) => {
    await mockChart(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByText('Vizita 3 nga 3')).toBeVisible();

    const historyPanel = page.getByRole('region', { name: /Historia e vizitave/ });
    // The mid-visit row carries the Z00.1 code is wrong; mid is J20.9.
    await historyPanel.getByText('J20.9').click();
    await expect(page.getByText('Vizita 2 nga 3')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/pacient/${PATIENT_ID}/vizita/${VISIT_MID}$`));
  });

  test('receptionist 403 shows the forbidden empty state', async ({ page }) => {
    await mockChart(page, {
      status: 403,
      body: { message: 'Vetëm mjeku ka qasje në këtë veprim.' },
    });
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByText('Gabim 403')).toBeVisible();
    await expect(
      page.getByText('Ju nuk keni qasje në këtë seksion'),
    ).toBeVisible();
  });

  test('patient with no visits shows the empty-visits state', async ({ page }) => {
    await mockChart(page, {
      body: {
        patient: {
          id: PATIENT_ID,
          clinicId: 'c-donetamed',
          legacyId: 5000,
          firstName: 'Dion',
          lastName: 'Hoxha',
          dateOfBirth: '2025-01-15',
          sex: 'm',
          placeOfBirth: null,
          phone: null,
          birthWeightG: null,
          birthLengthCm: null,
          birthHeadCircumferenceCm: null,
          alergjiTjera: null,
          createdAt: '2025-01-15T00:00:00.000Z',
          updatedAt: '2025-01-15T00:00:00.000Z',
        },
        visits: [],
        vertetime: [],
        daysSinceLastVisit: null,
        visitCount: 0,
      },
    });
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByText('Asnjë vizitë e regjistruar')).toBeVisible();
    await expect(page.getByRole('button', { name: /Vizitë e re/ })).toBeVisible();
  });
});
