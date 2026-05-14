import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * E2E for slice 16 — DICOM bridge (picker + lightbox + chart panel).
 *
 * API mocked at the route layer; image previews resolve to a tiny
 * 1×1 PNG byte sequence (just enough for the browser to consider
 * the <img> loaded). The Orthanc service is never spoken to — every
 * request the chart makes is intercepted here.
 *
 * Coverage:
 *   1. Chart renders the Ultrazeri panel with the existing linked
 *      study's thumbnail.
 *   2. "+ Lidh studim" opens the picker, lists 10 recent studies.
 *   3. Selecting + clicking "Lidh me këtë vizitë" POSTs the link;
 *      the picker closes; the panel updates.
 *   4. Clicking a linked thumbnail opens the lightbox.
 *   5. Lightbox arrow buttons step through multi-image studies and
 *      the counter updates.
 *   6. Esc closes the lightbox.
 */

const PATIENT_ID = '11111111-1111-4111-8111-111111111111';
const VISIT_ID = '22222222-2222-4222-8222-222222222222';
const LINKED_STUDY_ID = '33333333-3333-4333-8333-333333333333';
const LINKED_LINK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PICKABLE_STUDY_ID = '44444444-4444-4444-8444-444444444444';

// 1×1 transparent PNG — the smallest valid bytes the browser will
// treat as a "loaded" image.
const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000100be0e36a40000000049454e44ae426082',
  'hex',
);

interface DicomCounters {
  recent: number;
  links: number;
  link: number;
  unlink: number;
  studyDetail: number;
  preview: number;
}

async function mockChart(page: Page): Promise<DicomCounters> {
  const counters: DicomCounters = {
    recent: 0,
    links: 0,
    link: 0,
    unlink: 0,
    studyDetail: 0,
    preview: 0,
  };

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
          birthWeightG: null,
          birthLengthCm: null,
          birthHeadCircumferenceCm: null,
          alergjiTjera: null,
          createdAt: '2023-08-03T10:00:00.000Z',
          updatedAt: '2026-05-14T09:00:00.000Z',
        },
        visits: [
          {
            id: VISIT_ID,
            visitDate: '2026-05-14',
            primaryDiagnosis: null,
            legacyDiagnosis: null,
            paymentCode: 'A',
            updatedAt: '2026-05-14T11:00:00.000Z',
          },
        ],
        vertetime: [],
        daysSinceLastVisit: 0,
        visitCount: 1,
        growthPoints: [],
      }),
    }),
  );

  await page.route(`**/api/visits/${VISIT_ID}`, (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        visit: {
          id: VISIT_ID,
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
          paymentCode: 'A',
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
        },
      }),
    });
  });
  await page.route(`**/api/visits/${VISIT_ID}/history*`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ entries: [] }),
    }),
  );

  // Linked studies start with one entry; we mutate after POST.
  let links = [
    {
      id: LINKED_LINK_ID,
      visitId: VISIT_ID,
      dicomStudyId: LINKED_STUDY_ID,
      linkedAt: '2026-05-14T10:30:00.000Z',
      study: {
        id: LINKED_STUDY_ID,
        orthancStudyId: '1.2.840.113619.linked-9999',
        receivedAt: '2026-05-14T10:25:00.000Z',
        imageCount: 8,
        studyDescription: 'Abdomen US',
      },
    },
  ];

  await page.route(`**/api/visits/${VISIT_ID}/dicom-links`, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      counters.links += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ links }),
      });
      return;
    }
    if (req.method() === 'POST') {
      counters.link += 1;
      const body = JSON.parse(req.postData() ?? '{}') as { dicomStudyId: string };
      const newLink = {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        visitId: VISIT_ID,
        dicomStudyId: body.dicomStudyId,
        linkedAt: '2026-05-14T11:00:00.000Z',
        study: {
          id: body.dicomStudyId,
          orthancStudyId: '1.2.840.113619.new-1234567',
          receivedAt: '2026-05-14T10:55:00.000Z',
          imageCount: 4,
          studyDescription: 'Renal US',
        },
      };
      links = [newLink, ...links];
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ link: newLink }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route('**/api/dicom/recent', async (route: Route) => {
    counters.recent += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        studies: [
          {
            id: PICKABLE_STUDY_ID,
            orthancStudyId: '1.2.840.113619.new-1234567',
            receivedAt: '2026-05-14T10:55:00.000Z',
            imageCount: 4,
            studyDescription: 'Renal US',
          },
          {
            id: LINKED_STUDY_ID,
            orthancStudyId: '1.2.840.113619.linked-9999',
            receivedAt: '2026-05-14T10:25:00.000Z',
            imageCount: 8,
            studyDescription: 'Abdomen US',
          },
        ],
      }),
    });
  });

  await page.route(`**/api/dicom/studies/${LINKED_STUDY_ID}`, async (route: Route) => {
    counters.studyDetail += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        study: {
          id: LINKED_STUDY_ID,
          orthancStudyId: '1.2.840.113619.linked-9999',
          receivedAt: '2026-05-14T10:25:00.000Z',
          imageCount: 4,
          studyDescription: 'Abdomen US',
          instances: [
            { id: 'inst-a', index: 1 },
            { id: 'inst-b', index: 2 },
            { id: 'inst-c', index: 3 },
            { id: 'inst-d', index: 4 },
          ],
        },
      }),
    });
  });

  await page.route('**/api/dicom/instances/**/preview.png', async (route: Route) => {
    counters.preview += 1;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' },
      body: PNG_BYTES,
    });
  });

  return counters;
}

test.describe('DICOM bridge', () => {
  test('Ultrazeri panel renders the existing linked study', async ({ page }) => {
    const counters = await mockChart(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByTestId('ultrazeri-panel')).toBeVisible();
    await expect(page.getByTestId(`ultrazeri-thumb-${LINKED_STUDY_ID}`)).toBeVisible();
    expect(counters.links).toBeGreaterThan(0);
  });

  test('"+ Lidh studim" opens the picker and lists recent studies', async ({ page }) => {
    await mockChart(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByTestId('ultrazeri-panel')).toBeVisible();
    await page.getByTestId('ultrazeri-open-picker').click();
    await expect(page.getByText('Lidh studim ultrazeri')).toBeVisible();
    // The already-linked study is shown but disabled.
    await expect(page.getByTestId(`dicom-picker-card-${PICKABLE_STUDY_ID}`)).toBeVisible();
    await expect(page.getByTestId(`dicom-picker-card-${LINKED_STUDY_ID}`)).toBeDisabled();
  });

  test('selecting a study and linking POSTs and updates the panel', async ({ page }) => {
    const counters = await mockChart(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByTestId('ultrazeri-open-picker').click();
    await page.getByTestId(`dicom-picker-card-${PICKABLE_STUDY_ID}`).click();
    await page.getByTestId('dicom-picker-link').click();
    await expect.poll(() => counters.link).toBeGreaterThan(0);
    // Picker closes; the panel re-fetches links and shows the new thumb.
    await expect(page.getByText('Lidh studim ultrazeri')).toBeHidden();
    await expect(page.getByTestId(`ultrazeri-thumb-${PICKABLE_STUDY_ID}`)).toBeVisible();
  });

  test('clicking a linked thumb opens the lightbox with navigation + counter', async ({ page }) => {
    const counters = await mockChart(page);
    await page.goto(`/pacient/${PATIENT_ID}`);
    await page.getByTestId(`ultrazeri-thumb-${LINKED_STUDY_ID}`).click();
    await expect(page.getByTestId('dicom-lightbox')).toBeVisible();
    await expect(page.getByTestId('dicom-lightbox-patient')).toHaveText('Era Krasniqi');
    await expect.poll(() => counters.studyDetail).toBeGreaterThan(0);
    // Counter starts at "1 / 4".
    await expect(page.getByTestId('dicom-lightbox-counter')).toContainText('1');
    await expect(page.getByTestId('dicom-lightbox-counter')).toContainText('4');
    // Step forward and check counter advances.
    await page.getByTestId('dicom-lightbox-next').click();
    await expect(page.getByTestId('dicom-lightbox-counter')).toContainText('2');
    // Esc closes
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dicom-lightbox')).toBeHidden();
  });
});
