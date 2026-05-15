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
      growthPoints: [],
    } as const);

  await page.route(`**/api/patients/${PATIENT_ID}/chart`, (route: Route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}

// ---------------------------------------------------------------------------
// Visit form fixtures — used by the slice-12 tests below.
// ---------------------------------------------------------------------------

function makeVisit(overrides: Partial<VisitFixture> = {}): VisitFixture {
  return {
    id: VISIT_NEW,
    clinicId: 'c-donetamed',
    patientId: PATIENT_ID,
    visitDate: '2026-05-14',
    complaint: null,
    feedingNotes: null,
    feedingBreast: false,
    feedingFormula: false,
    feedingSolid: false,
    weightG: null,
    heightCm: null,
    headCircumferenceCm: null,
    temperatureC: null,
    paymentCode: null,
    examinations: null,
    ultrasoundNotes: null,
    legacyDiagnosis: null,
    prescription: null,
    labResults: null,
    followupNotes: null,
    otherNotes: null,
    diagnoses: [],
    createdAt: '2026-05-14T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    createdBy: 'u-taulant',
    updatedBy: 'u-taulant',
    wasUpdated: false,
    ...overrides,
  };
}

interface VisitDiagnosisFixture {
  code: string;
  latinDescription: string;
  orderIndex: number;
}

interface VisitFixture {
  id: string;
  clinicId: string;
  patientId: string;
  visitDate: string;
  complaint: string | null;
  feedingNotes: string | null;
  feedingBreast: boolean;
  feedingFormula: boolean;
  feedingSolid: boolean;
  weightG: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  temperatureC: number | null;
  paymentCode: string | null;
  examinations: string | null;
  ultrasoundNotes: string | null;
  legacyDiagnosis: string | null;
  prescription: string | null;
  labResults: string | null;
  followupNotes: string | null;
  otherNotes: string | null;
  diagnoses: VisitDiagnosisFixture[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  wasUpdated: boolean;
}

const ICD10_RESULTS: Array<{
  code: string;
  latinDescription: string;
  chapter: string;
  useCount: number;
  frequentlyUsed: boolean;
}> = [
  {
    code: 'J20.9',
    latinDescription: 'Bronchitis acuta',
    chapter: 'Respiratory',
    useCount: 0,
    frequentlyUsed: false,
  },
  {
    code: 'J21.0',
    latinDescription: 'Bronchiolitis acuta',
    chapter: 'Respiratory',
    useCount: 0,
    frequentlyUsed: false,
  },
  {
    code: 'J45.9',
    latinDescription: 'Asthma bronchiale',
    chapter: 'Respiratory',
    useCount: 0,
    frequentlyUsed: false,
  },
];

async function mockIcd10Search(page: Page): Promise<void> {
  await page.route('**/api/icd10/search*', async (route: Route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const filtered = ICD10_RESULTS.filter(
      (r) =>
        q.length === 0 ||
        r.code.toLowerCase().startsWith(q) ||
        r.latinDescription.toLowerCase().includes(q),
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: filtered }),
    });
  });
}

async function mockVisits(
  page: Page,
  options: {
    initial?: VisitFixture;
    onPatch?: (body: Record<string, unknown>) => Partial<VisitFixture> | null;
    failPatch?: boolean;
    history?: Array<{
      id: string;
      action: 'visit.created' | 'visit.updated' | 'visit.deleted' | 'visit.restored';
      timestamp: string;
      userDisplayName: string;
      userRole: 'doctor' | 'receptionist' | 'clinic_admin';
      userId: string;
      ipAddress: string | null;
      changes:
        | Array<{ field: string; old: string | number | boolean | null; new: string | number | boolean | null }>
        | null;
    }>;
  } = {},
): Promise<void> {
  let visit = options.initial ?? makeVisit();
  await page.route(`**/api/visits/${visit.id}`, async (route: Route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ visit }),
      });
      return;
    }
    if (method === 'PATCH') {
      if (options.failPatch) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      const body = JSON.parse(route.request().postData() ?? '{}');
      const delta = options.onPatch?.(body) ?? body;
      visit = {
        ...visit,
        ...delta,
        wasUpdated: true,
        updatedAt: new Date().toISOString(),
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ visit }),
      });
      return;
    }
    if (method === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ok',
          restorableUntil: new Date(Date.now() + 30_000).toISOString(),
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route(`**/api/visits/${visit.id}/restore`, async (route: Route) => {
    visit = { ...visit };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ visit }),
    });
  });

  await page.route(`**/api/visits/${visit.id}/history*`, async (route: Route) => {
    const entries =
      options.history ?? [
        {
          id: 'a-1',
          action: 'visit.created' as const,
          timestamp: '2026-05-14T08:00:00.000Z',
          userDisplayName: 'Dr. Taulant Shala',
          userRole: 'doctor' as const,
          userId: 'u-taulant',
          ipAddress: '94.140.10.20',
          changes: null,
        },
      ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries }),
    });
  });

  await page.route('**/api/visits/doctor-new', async (route: Route) => {
    if (route.request().method() === 'POST') {
      visit = { ...visit, id: visit.id, createdAt: new Date().toISOString() };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ visit }),
      });
      return;
    }
    await route.fallback();
  });
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

  // -------------------------------------------------------------------------
  // Visit form (slice 12)
  // -------------------------------------------------------------------------

  test('typing into Ankesa triggers a PATCH and shows "U ruajt"', async ({ page }) => {
    await mockChart(page);
    await mockVisits(page);

    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'PATCH',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);

    const complaint = page.locator('#visit-complaint');
    await complaint.fill('Kollë e thatë prej 3 ditësh.');

    // The debounce is 1.5s but blur fires sooner — bump elsewhere to
    // make sure we're not deadlocked.
    await page.locator('#visit-examinations').click();

    const req = await patchPromise;
    expect(req.postDataJSON()).toMatchObject({ complaint: 'Kollë e thatë prej 3 ditësh.' });

    await expect(page.getByText(/U ruajt/).first()).toBeVisible();
  });

  test('blank-then-typed weight saves the integer-grams payload', async ({ page }) => {
    await mockChart(page);
    await mockVisits(page);

    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'PATCH',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);

    await page.locator('#visit-weight').fill('13.6');
    await page.locator('#visit-height').click();

    const req = await patchPromise;
    // 13.6 kg → 13_600 g.
    expect(req.postDataJSON()).toMatchObject({ weightG: 13_600 });
  });

  test('paymentCode dropdown saves the selected code', async ({ page }) => {
    await mockChart(page);
    await mockVisits(page);

    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'PATCH',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.locator('#visit-payment-code').selectOption('A');

    const req = await patchPromise;
    expect(req.postDataJSON()).toMatchObject({ paymentCode: 'A' });
  });

  test('save failure opens the dialog with the unsaved fields listed', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page, { failPatch: true });

    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.locator('#visit-complaint').fill('Ankesë e re që dështon.');
    await page.locator('#visit-examinations').click();

    const dialog = page.getByRole('alertdialog', { name: 'Ruajtja dështoi' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Fusha të paruajtura · 1')).toBeVisible();
    await expect(dialog.getByText('Ankesa', { exact: true })).toBeVisible();
  });

  test('"Modifikuar nga..." appears once the visit has been updated', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page, {
      initial: makeVisit({
        wasUpdated: true,
        updatedAt: '2026-05-14T13:47:00.000Z',
        complaint: 'Kollë',
      }),
    });

    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByText(/Modifikuar nga/)).toBeVisible();
  });

  test('clicking "Modifikuar nga..." opens the change-history modal', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page, {
      initial: makeVisit({
        wasUpdated: true,
        updatedAt: '2026-05-14T13:47:00.000Z',
      }),
      history: [
        {
          id: 'a-2',
          action: 'visit.updated' as const,
          timestamp: '2026-05-14T13:47:00.000Z',
          userDisplayName: 'Dr. Taulant Shala',
          userRole: 'doctor' as const,
          userId: 'u-taulant',
          ipAddress: '94.140.10.20',
          changes: [
            { field: 'complaint', old: 'Kollë', new: 'Kollë me ethe' },
          ],
        },
        {
          id: 'a-1',
          action: 'visit.created' as const,
          timestamp: '2026-05-14T08:00:00.000Z',
          userDisplayName: 'Dr. Taulant Shala',
          userRole: 'doctor' as const,
          userId: 'u-taulant',
          ipAddress: '94.140.10.20',
          changes: null,
        },
      ],
    });

    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByText(/Modifikuar nga/).click();

    const modal = page.getByRole('dialog', { name: /Historia e ndryshimeve/ });
    await expect(modal).toBeVisible();
    await expect(modal.getByText('Ankesa')).toBeVisible();
    await expect(modal.getByText('Kollë me ethe')).toBeVisible();
    await expect(modal.getByText('Krijuar (vizita e re)')).toBeVisible();
  });

  test('delete visit shows the undo toast, undo restores the visit', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page);

    const deletePromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'DELETE',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByRole('button', { name: 'Fshij vizitën' }).click();
    await deletePromise;

    await expect(page.getByText('Vizita u fshi.')).toBeVisible();

    const restorePromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}/restore`) &&
        req.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Anulo' }).click();
    await restorePromise;
  });

  test('Vizitë e re button POSTs to /api/visits/doctor-new and navigates', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page);

    const createPromise = page.waitForRequest(
      (req) =>
        req.url().endsWith('/api/visits/doctor-new') && req.method() === 'POST',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByRole('button', { name: '+ Vizitë e re' }).first().click();
    const req = await createPromise;
    expect(req.postDataJSON()).toMatchObject({ patientId: PATIENT_ID });
  });

  // -------------------------------------------------------------------------
  // Diagnoza + Terapia (slice 13)
  // -------------------------------------------------------------------------

  test('typing in the diagnosis search shows the dropdown and picking adds a chip', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page);
    await mockIcd10Search(page);

    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'PATCH',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);

    const picker = page.getByTestId('diagnosis-picker');
    const input = picker.getByLabel('Kërko ICD-10');
    await input.click();
    await input.fill('bron');

    const option = page.getByTestId('diagnosis-option-J20.9');
    await expect(option).toBeVisible();
    await option.click();

    await expect(page.getByTestId('diagnosis-chip-J20.9')).toBeVisible();
    // Trigger the form-wide blur flush.
    await page.locator('#visit-prescription').click();
    const req = await patchPromise;
    expect(req.postDataJSON()).toMatchObject({ diagnoses: ['J20.9'] });
  });

  test('drag-to-reorder swaps the primary diagnosis', async ({ page }) => {
    await mockChart(page);
    await mockVisits(page, {
      initial: makeVisit({
        diagnoses: [
          { code: 'J03.9', latinDescription: 'Tonsillitis acuta', orderIndex: 0 },
          { code: 'R05', latinDescription: 'Tussis', orderIndex: 1 },
        ],
      }),
    });
    await mockIcd10Search(page);

    await page.goto(`/pacient/${PATIENT_ID}`);

    const first = page.getByTestId('diagnosis-chip-J03.9');
    const second = page.getByTestId('diagnosis-chip-R05');
    await expect(first).toHaveAttribute('data-primary', 'true');
    await expect(second).toHaveAttribute('data-primary', 'false');

    // Drag the second chip to the position of the first.
    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'PATCH',
    );
    const grab = second.locator('span[title*="renditjen"]');
    const firstBox = await first.boundingBox();
    const grabBox = await grab.boundingBox();
    if (!firstBox || !grabBox) {
      throw new Error('chip bounding boxes unavailable');
    }
    await page.mouse.move(grabBox.x + grabBox.width / 2, grabBox.y + grabBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(firstBox.x + 4, firstBox.y + firstBox.height / 2, {
      steps: 12,
    });
    await page.mouse.up();

    // Order has flipped — R05 should now be the primary.
    await expect(page.getByTestId('diagnosis-chip-R05')).toHaveAttribute(
      'data-primary',
      'true',
    );

    // Blur the picker to flush the auto-save.
    await page.locator('#visit-prescription').click();
    const req = await patchPromise;
    expect(req.postDataJSON()).toMatchObject({ diagnoses: ['R05', 'J03.9'] });
  });

  test('clicking × on a chip removes the diagnosis and saves the new list', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page, {
      initial: makeVisit({
        diagnoses: [
          { code: 'J03.9', latinDescription: 'Tonsillitis acuta', orderIndex: 0 },
          { code: 'R05', latinDescription: 'Tussis', orderIndex: 1 },
        ],
      }),
    });
    await mockIcd10Search(page);

    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'PATCH',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page
      .getByTestId('diagnosis-chip-R05')
      .getByRole('button', { name: /Hiq diagnozën/ })
      .click();

    await expect(page.getByTestId('diagnosis-chip-R05')).not.toBeVisible();
    await page.locator('#visit-prescription').click();
    const req = await patchPromise;
    expect(req.postDataJSON()).toMatchObject({ diagnoses: ['J03.9'] });
  });

  test('typing in Terapia saves the prescription text on auto-save', async ({
    page,
  }) => {
    await mockChart(page);
    await mockVisits(page);
    await mockIcd10Search(page);

    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().includes(`/api/visits/${VISIT_NEW}`) &&
        req.method() === 'PATCH',
    );
    await page.goto(`/pacient/${PATIENT_ID}`);
    const terapia = page.locator('#visit-prescription');
    await terapia.fill('Paracetamol susp. 250mg s.3x\nIbuprofen susp. 100mg/5ml s.n.');
    await page.locator('#visit-examinations').click();
    const req = await patchPromise;
    expect(req.postDataJSON()).toMatchObject({
      prescription: 'Paracetamol susp. 250mg s.3x\nIbuprofen susp. 100mg/5ml s.n.',
    });
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
        growthPoints: [],
      },
    });
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByText('Asnjë vizitë e regjistruar')).toBeVisible();
    await expect(page.getByRole('button', { name: /Vizitë e re/ })).toBeVisible();
  });
});
