import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * E2E for the WHO growth charts (slice 14).
 *
 * Coverage:
 *   1. Boy under 24 months — blue sparkline cards visible, click opens
 *      modal, "Djalë" chip + blue patient line + three working tabs.
 *   2. Girl under 24 months — pink sparkline cards + "Vajzë" chip.
 *   3. Patient with no recorded measurements — empty state with the
 *      "Asnjë e dhënë e regjistruar" copy from components/empty-states.
 *   4. Patient past 24 months with infancy data — historical link
 *      replaces the sparkline cards.
 *   5. Patient without resolved sex — placeholder + inline "Cakto
 *      gjininë" flow PATCHes /api/patients/:id.
 */

const PATIENT_ID = 'a11a11a1-1111-4111-8111-111111111111';

interface GrowthPointFixture {
  visitId: string;
  visitDate: string;
  ageMonths: number;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
}

const SAMPLE_POINTS: GrowthPointFixture[] = [
  { visitId: 'p1', visitDate: '2024-09-12', ageMonths: 0, weightKg: 3.3, heightCm: 51, headCircumferenceCm: 34 },
  { visitId: 'p2', visitDate: '2024-12-12', ageMonths: 3, weightKg: 6.1, heightCm: 60, headCircumferenceCm: 40.5 },
  { visitId: 'p3', visitDate: '2025-03-12', ageMonths: 6, weightKg: 7.4, heightCm: 66, headCircumferenceCm: 42.0 },
  { visitId: 'p4', visitDate: '2025-09-12', ageMonths: 12, weightKg: 9.5, heightCm: 74, headCircumferenceCm: 45.0 },
  { visitId: 'p5', visitDate: '2026-03-12', ageMonths: 18, weightKg: 11.0, heightCm: 80, headCircumferenceCm: 46.5 },
];

interface ChartFixture {
  sex: 'm' | 'f' | null;
  firstName?: string;
  dateOfBirth: string;
  growthPoints?: GrowthPointFixture[];
  visits?: unknown[];
}

async function mockChart(page: Page, fixture: ChartFixture): Promise<void> {
  await page.route(`**/api/patients/${PATIENT_ID}/chart`, (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        patient: {
          id: PATIENT_ID,
          clinicId: 'c-donetamed',
          legacyId: 7300,
          firstName: fixture.firstName ?? (fixture.sex === 'f' ? 'Era' : 'Dion'),
          lastName: 'Krasniqi',
          dateOfBirth: fixture.dateOfBirth,
          sex: fixture.sex,
          placeOfBirth: 'Prizren',
          phone: null,
          birthWeightG: 3300,
          birthLengthCm: 51,
          birthHeadCircumferenceCm: 34,
          alergjiTjera: null,
          createdAt: '2024-09-12T08:00:00.000Z',
          updatedAt: '2026-05-14T09:00:00.000Z',
        },
        visits: fixture.visits ?? [],
        vertetime: [],
        daysSinceLastVisit: null,
        visitCount: fixture.visits?.length ?? 0,
        growthPoints: fixture.growthPoints ?? [],
      }),
    }),
  );
}

test.describe('WHO growth charts', () => {
  test('boy 0-24mo: blue sparklines, modal opens with Djalë chip and three tabs', async ({
    page,
  }) => {
    await mockChart(page, {
      sex: 'm',
      firstName: 'Dion',
      dateOfBirth: '2024-09-12',
      growthPoints: SAMPLE_POINTS,
    });
    await page.goto(`/pacient/${PATIENT_ID}`);

    const sparklines = page.getByTestId('growth-sparklines');
    await expect(sparklines).toBeVisible();

    const weightCard = page.getByTestId('growth-sparkline-weight');
    await expect(weightCard).toHaveAttribute('data-tone', 'male');

    // Each of the three sparklines is rendered.
    await expect(page.getByTestId('growth-sparkline-svg-weight')).toBeVisible();
    await expect(page.getByTestId('growth-sparkline-svg-length')).toBeVisible();
    await expect(page.getByTestId('growth-sparkline-svg-hc')).toBeVisible();

    // Open the modal via the weight card.
    await weightCard.click();
    const dialog = page.getByRole('dialog', { name: /Pesha sipas moshës/ });
    await expect(dialog).toBeVisible();

    // "Djalë" chip with the male tone.
    const chip = page.getByTestId('growth-modal-sex-chip');
    await expect(chip).toHaveText('Djalë');
    await expect(chip).toHaveAttribute('data-tone', 'male');

    // Patient line uses the boy color (resolved at runtime).
    const patientLine = page.getByTestId('patient-line');
    const strokeColor = await patientLine.evaluate((el) =>
      window.getComputedStyle(el).stroke,
    );
    // The browser resolves var(--chart-male) to rgb(74,144,217)
    // (#4A90D9 — canonical klinika v1.2 sex tint for boys).
    expect(strokeColor.replace(/\s/g, '')).toBe('rgb(74,144,217)');

    // Tab between metrics — title swaps and the data table re-fills.
    await dialog.getByRole('tab', { name: 'Gjatësia' }).click();
    await expect(dialog.getByRole('heading', { name: 'Gjatësia sipas moshës' })).toBeVisible();

    await dialog.getByRole('tab', { name: 'Perimetri kokës' }).click();
    await expect(
      dialog.getByRole('heading', { name: 'Perimetri i kokës sipas moshës' }),
    ).toBeVisible();

    // Mbyll closes the modal.
    await dialog.getByRole('button', { name: 'Mbyll' }).click();
    await expect(dialog).not.toBeVisible();
  });

  test('girl 0-24mo: pink sparklines and Vajzë chip', async ({ page }) => {
    await mockChart(page, {
      sex: 'f',
      firstName: 'Era',
      dateOfBirth: '2024-09-12',
      growthPoints: SAMPLE_POINTS,
    });
    await page.goto(`/pacient/${PATIENT_ID}`);

    const weightCard = page.getByTestId('growth-sparkline-weight');
    await expect(weightCard).toHaveAttribute('data-tone', 'female');

    await weightCard.click();
    const dialog = page.getByRole('dialog', { name: /Pesha sipas moshës/ });
    const chip = page.getByTestId('growth-modal-sex-chip');
    await expect(chip).toHaveText('Vajzë');
    await expect(chip).toHaveAttribute('data-tone', 'female');

    const stroke = await page
      .getByTestId('patient-line')
      .evaluate((el) => window.getComputedStyle(el).stroke);
    // var(--chart-female) is rgb(232,114,142) (#E8728E — canonical
    // klinika v1.2 sex tint for girls).
    expect(stroke.replace(/\s/g, '')).toBe('rgb(232,114,142)');
  });

  test('empty state when no measurements recorded', async ({ page }) => {
    await mockChart(page, {
      sex: 'm',
      dateOfBirth: '2024-09-12',
      growthPoints: [],
    });
    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByTestId('growth-empty')).toBeVisible();
    await expect(page.getByText('Asnjë e dhënë e regjistruar')).toBeVisible();
  });

  test('past 24 months with infancy data shows the historical link', async ({
    page,
  }) => {
    await mockChart(page, {
      sex: 'm',
      firstName: 'Dion',
      // Born 2022-01-01 → 4y+ on 2026-05-14.
      dateOfBirth: '2022-01-01',
      growthPoints: [
        { visitId: 'h1', visitDate: '2022-04-01', ageMonths: 3, weightKg: 6.0, heightCm: 60, headCircumferenceCm: 40 },
        { visitId: 'h2', visitDate: '2023-01-01', ageMonths: 12, weightKg: 9.5, heightCm: 75, headCircumferenceCm: 45 },
      ],
    });
    await page.goto(`/pacient/${PATIENT_ID}`);

    // Sparkline cards are gone, link is present.
    await expect(page.getByTestId('growth-sparklines')).toHaveCount(0);
    await expect(page.getByText('Shiko grafikët historikë')).toBeVisible();

    await page.getByText('Shiko grafikët historikë').click();
    const dialog = page.getByRole('dialog', { name: /Historiku 0-24 muaj/ });
    await expect(dialog).toBeVisible();
  });

  test('unresolved sex shows the placeholder + inline set-sex flow', async ({
    page,
  }) => {
    await mockChart(page, {
      sex: null,
      // First name "Xy" is intentionally ambiguous — name inference
      // returns null so the placeholder renders.
      firstName: 'Xy',
      dateOfBirth: '2024-09-12',
      growthPoints: SAMPLE_POINTS,
    });

    // PATCH endpoint accepts the new sex and returns the updated record.
    await page.route(`**/api/patients/${PATIENT_ID}`, (route: Route) => {
      if (route.request().method() === 'PATCH') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            patient: {
              id: PATIENT_ID,
              clinicId: 'c-donetamed',
              legacyId: 7300,
              firstName: 'Xy',
              lastName: 'Krasniqi',
              dateOfBirth: '2024-09-12',
              sex: 'm',
              placeOfBirth: 'Prizren',
              phone: null,
              birthWeightG: 3300,
              birthLengthCm: 51,
              birthHeadCircumferenceCm: 34,
              alergjiTjera: null,
              createdAt: '2024-09-12T08:00:00.000Z',
              updatedAt: '2026-05-14T09:00:00.000Z',
            },
          }),
        });
      }
      return route.fallback();
    });

    await page.goto(`/pacient/${PATIENT_ID}`);
    await expect(page.getByTestId('growth-unknown-sex')).toBeVisible();
    await expect(
      page.getByText('Përcaktoni gjininë e pacientit për të parë grafikët.'),
    ).toBeVisible();

    const patchPromise = page.waitForRequest(
      (req) =>
        req.url().endsWith(`/api/patients/${PATIENT_ID}`) &&
        req.method() === 'PATCH',
    );
    await page.getByRole('button', { name: 'Cakto gjininë' }).click();
    await page.getByTestId('set-sex-option-m').click();
    await page.getByTestId('set-sex-save').click();
    const req = await patchPromise;
    expect(req.postDataJSON()).toMatchObject({ sex: 'm' });

    // Once saved, the panel re-renders with the sparklines visible.
    await expect(page.getByTestId('growth-sparklines')).toBeVisible();
  });
});
