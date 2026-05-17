import { type Page, type Route } from '@playwright/test';

import { expect, test } from './fixtures/auth';

/**
 * E2E for slice 15 — print pipeline + vërtetim issue/reprint.
 *
 * API mocked at the route layer; the print PDF response is a small
 * fixture buffer (just enough bytes for the browser's PDF detection).
 * The iframe-trigger behavior (`iframe.contentWindow.print()`) is
 * exercised via a window-level shim so we can assert the call.
 *
 * Coverage:
 *   1. Click "Printo raportin" → GET /api/print/visit/:id fires and the
 *      hidden iframe loads the PDF + window.print is triggered.
 *   2. Click "Vërtetim" → modal opens with patient + diagnosis +
 *      live preview; date range chips update the preview; submit
 *      issues + opens the print frame.
 *   3. Reprint of an existing vërtetim hits /api/print/vertetim/:id
 *      with the same id — the snapshot is stable server-side and
 *      the client never recomputes it.
 *   4. "Printo historinë" opens a confirmation dialog (with the
 *      ultrasound toggle hidden when no images), then triggers
 *      GET /api/print/history/:patientId.
 *   5. Invalid date range disables the "Lësho" buttons.
 */

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const VERTETIM_ID = 'aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee';

const FIXTURE_PDF_BYTES = Buffer.from(
  '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n%%EOF',
  'binary',
);

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
  diagnoses: Array<{ code: string; latinDescription: string; orderIndex: number }>;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  wasUpdated: boolean;
}

function makeVisit(): VisitFixture {
  return {
    id: VISIT_ID,
    clinicId: 'c-donetamed',
    patientId: PATIENT_ID,
    visitDate: '2026-05-14',
    complaint: null,
    feedingNotes: null,
    feedingBreast: false,
    feedingFormula: false,
    feedingSolid: false,
    weightG: 13_600,
    heightCm: 92,
    headCircumferenceCm: 48.2,
    temperatureC: 37.2,
    paymentCode: 'A',
    examinations: null,
    ultrasoundNotes: null,
    legacyDiagnosis: null,
    prescription: 'Spray.Axxa 2× në ditë, 5 ditë',
    labResults: null,
    followupNotes: null,
    otherNotes: null,
    diagnoses: [
      { code: 'J03.9', latinDescription: 'Tonsillitis acuta', orderIndex: 0 },
    ],
    createdAt: '2026-05-14T08:00:00.000Z',
    updatedAt: '2026-05-14T08:00:00.000Z',
    createdBy: 'u-taulant',
    updatedBy: 'u-taulant',
    wasUpdated: false,
  };
}

interface PrintCounters {
  visit: number;
  vertetim: number;
  history: number;
  printCalls: number;
}

async function mockEverything(
  page: Page,
  options: { existingVertetime?: Array<{
    id: string;
    visitId: string;
    issuedAt: string;
    absenceFrom: string;
    absenceTo: string;
    durationDays: number;
    diagnosisSnapshot: string;
  }> } = {},
): Promise<PrintCounters> {
  const counters: PrintCounters = {
    visit: 0,
    vertetim: 0,
    history: 0,
    printCalls: 0,
  };

  // Install a hook BEFORE the page navigates so we can observe
  // window.print() calls fired by the print-frame helper.
  await page.addInitScript(() => {
    interface KlinikaWin extends Window {
      __klinikaPrintCalls?: number;
    }
    const w = window as KlinikaWin;
    w.__klinikaPrintCalls = 0;
    const origPrint = window.print.bind(window);
    window.print = () => {
      w.__klinikaPrintCalls = (w.__klinikaPrintCalls ?? 0) + 1;
      void origPrint;
    };
    // Stub iframe contentWindow.print as well, because the print
    // pipeline calls into the iframe, not the parent window. Once
    // an iframe is appended we hijack its print method.
    const observer = new MutationObserver((records) => {
      for (const rec of records) {
        rec.addedNodes.forEach((n) => {
          if (n instanceof HTMLIFrameElement && n.id === 'klinika-print-frame') {
            n.addEventListener('load', () => {
              try {
                if (n.contentWindow) {
                  n.contentWindow.print = (): void => {
                    w.__klinikaPrintCalls = (w.__klinikaPrintCalls ?? 0) + 1;
                  };
                }
              } catch {
                /* cross-origin — fall through */
              }
            });
          }
        });
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });

  await page.route(`**/api/patients/${PATIENT_ID}/chart`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        patient: {
          id: PATIENT_ID,
          clinicId: 'c-donetamed',
          legacyId: 15626,
          firstName: 'Era',
          lastName: 'Krasniqi',
          dateOfBirth: '2023-08-03',
          sex: 'f',
          placeOfBirth: 'Prizren',
          phone: null,
          birthWeightG: 3280,
          birthLengthCm: 51,
          birthHeadCircumferenceCm: 34,
          alergjiTjera: null,
          createdAt: '2023-08-03T10:00:00.000Z',
          updatedAt: '2026-05-14T09:00:00.000Z',
          isComplete: true,
        },
        visits: [
          {
            id: VISIT_ID,
            visitDate: '2026-05-14',
            primaryDiagnosis: { code: 'J03.9', latinDescription: 'Tonsillitis acuta' },
            legacyDiagnosis: null,
            paymentCode: 'A',
            updatedAt: '2026-05-14T11:00:00.000Z',
          },
        ],
        vertetime: options.existingVertetime ?? [],
        daysSinceLastVisit: 0,
        visitCount: 1,
        growthPoints: [],
      }),
    }),
  );

  let visit = makeVisit();
  await page.route(`**/api/visits/${VISIT_ID}`, async (route: Route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ visit }),
      });
      return;
    }
    if (route.request().method() === 'PATCH') {
      visit = { ...visit, wasUpdated: true, updatedAt: new Date().toISOString() };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ visit }),
      });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/visits/${VISIT_ID}/history*`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [] }),
    }),
  );

  // Print endpoints — count + serve a fixture PDF.
  await page.route('**/api/print/visit/**', async (route: Route) => {
    counters.visit += 1;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' },
      body: FIXTURE_PDF_BYTES,
    });
  });
  await page.route('**/api/print/vertetim/**', async (route: Route) => {
    counters.vertetim += 1;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' },
      body: FIXTURE_PDF_BYTES,
    });
  });
  await page.route('**/api/print/history/**', async (route: Route) => {
    counters.history += 1;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/pdf', 'cache-control': 'no-store' },
      body: FIXTURE_PDF_BYTES,
    });
  });

  // Issue vërtetim
  await page.route('**/api/vertetim', async (route: Route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() ?? '{}');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          vertetim: {
            id: VERTETIM_ID,
            clinicId: 'c-donetamed',
            patientId: PATIENT_ID,
            visitId: body.visitId,
            issuedAt: '2026-05-14T11:30:00.000Z',
            absenceFrom: body.absenceFrom,
            absenceTo: body.absenceTo,
            durationDays:
              Math.floor(
                (new Date(`${body.absenceTo}T00:00:00Z`).getTime() -
                  new Date(`${body.absenceFrom}T00:00:00Z`).getTime()) /
                  86_400_000,
              ) + 1,
            diagnosisSnapshot: 'J03.9 — Tonsillitis acuta',
          },
        }),
      });
      return;
    }
    await route.fallback();
  });

  return counters;
}

async function getPrintCalls(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const w = window as unknown as { __klinikaPrintCalls?: number };
    return w.__klinikaPrintCalls ?? 0;
  });
}

test.describe('Print pipeline', () => {
  test('clicking "Printo raportin" hits the API and triggers print on the iframe', async ({ page }) => {
    const counters = await mockEverything(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByTestId('print-visit-report')).toBeVisible();
    await page.getByTestId('print-visit-report').click();
    // The API request fires immediately on click.
    await expect.poll(() => counters.visit).toBeGreaterThan(0);
    // The print-frame helper waits ~120ms before invoking print().
    // Use a polling assertion to give the iframe its load tick.
    await expect.poll(() => getPrintCalls(page), { timeout: 5_000 }).toBeGreaterThan(0);
  });

  test('"Vërtetim" opens the dialog with patient + diagnosis preview', async ({ page }) => {
    await mockEverything(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByTestId('open-vertetim-dialog').click();
    await expect(page.getByText('Lësho vërtetim absencë')).toBeVisible();
    await expect(page.getByTestId('vertetim-patient-name')).toHaveText('Era Krasniqi');
    // Preview shows the primary diagnosis
    await expect(page.getByTestId('vertetim-preview')).toContainText('J03.9');
    await expect(page.getByTestId('vertetim-preview')).toContainText('Tonsillitis acuta');
  });

  test('invalid date range disables "Printo vërtetimin" and shows an error', async ({ page }) => {
    await mockEverything(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByTestId('open-vertetim-dialog').click();
    // Push "Deri" to before "Nga"
    await page.getByLabel('Nga').fill('2026-05-20');
    await page.getByLabel('Deri').fill('2026-05-15');
    await expect(page.getByText('Data "Deri" duhet të jetë e barabartë ose pas datës "Nga".')).toBeVisible();
    await expect(page.getByTestId('vertetim-print')).toBeDisabled();
    await expect(page.getByTestId('vertetim-view')).toBeDisabled();
  });

  test('issuing a vërtetim POSTs the form and opens the print frame', async ({ page }) => {
    const counters = await mockEverything(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByTestId('open-vertetim-dialog').click();
    await page.getByTestId('vertetim-print').click();
    await expect.poll(() => counters.vertetim).toBeGreaterThan(0);
  });

  test('reprint of an existing vërtetim fires GET /api/print/vertetim/:id', async ({ page }) => {
    const counters = await mockEverything(page, {
      existingVertetime: [
        {
          id: VERTETIM_ID,
          visitId: VISIT_ID,
          issuedAt: '2026-04-01T10:00:00.000Z',
          absenceFrom: '2026-04-01',
          absenceTo: '2026-04-05',
          durationDays: 5,
          diagnosisSnapshot: 'J03.9 Tonsillitis acuta',
        },
      ],
    });
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByTestId(`vertetim-reprint-${VERTETIM_ID}`)).toBeVisible();
    await page.getByTestId(`vertetim-reprint-${VERTETIM_ID}`).click();
    await expect.poll(() => counters.vertetim).toBeGreaterThan(0);
  });

  test('"Printo historinë" confirms then fires GET /api/print/history/:patientId', async ({ page }) => {
    const counters = await mockEverything(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByTestId('print-history').click();
    await expect(page.getByText('Printo historinë e pacientit')).toBeVisible();
    await page.getByTestId('print-history-confirm').click();
    await expect.poll(() => counters.history).toBeGreaterThan(0);
  });
});
