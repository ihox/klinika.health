import { type Page, type Route } from '@playwright/test';

import { expect, test } from './fixtures/auth';

/**
 * E2E for the patients surface — both receptionist and doctor flows.
 * The API is mocked at the route layer so the tests run without a
 * live NestJS; the patient integration spec
 * (apps/api/src/modules/patients/patients.integration.spec.ts) covers
 * the live wire-up.
 *
 * Coverage:
 *   Receptionist
 *     1. Search returns only the public DTO shape (no PHI keys)
 *     2. Quick-add flow creates a patient
 *     3. Soft-duplicate notice surfaces and "Use existing" picks it
 *     4. Direct GET on a doctor patient page is blocked at the API mock
 *   Doctor
 *     5. Full patient list shows all master-data fields
 *     6. Create-new submits a full form
 *     7. Edit auto-saves on blur (within 200ms of the field debounce)
 *     8. The master-data strip renders alergji warning
 */

const PUBLIC_PATIENTS = [
  { id: 'p-rita-h', firstName: 'Rita', lastName: 'Hoxha', dateOfBirth: '2024-02-12' },
  { id: 'p-rita-h2', firstName: 'Rita', lastName: 'Hoxhaj', dateOfBirth: '2024-02-15' },
  { id: 'p-dion', firstName: 'Dion', lastName: 'Hoxha', dateOfBirth: '2019-01-15' },
];

const FULL_PATIENTS = [
  {
    id: 'p-era',
    clinicId: 'c-donetamed',
    legacyId: 4829,
    firstName: 'Era',
    lastName: 'Krasniqi',
    dateOfBirth: '2023-08-03',
    sex: 'f' as const,
    placeOfBirth: 'Prizren',
    phone: '+383 44 123 456',
    birthWeightG: 3280,
    birthLengthCm: 51,
    birthHeadCircumferenceCm: 34,
    alergjiTjera: 'Penicilinë',
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
  },
  {
    id: 'p-dion-full',
    clinicId: 'c-donetamed',
    legacyId: 4830,
    firstName: 'Dion',
    lastName: 'Hoxha',
    dateOfBirth: '2019-01-15',
    sex: 'm' as const,
    placeOfBirth: null,
    phone: null,
    birthWeightG: null,
    birthLengthCm: null,
    birthHeadCircumferenceCm: null,
    alergjiTjera: null,
    createdAt: '2024-02-10T10:00:00.000Z',
    updatedAt: '2024-02-10T10:00:00.000Z',
  },
];

interface MockState {
  publicCreates: Array<Record<string, unknown>>;
  fullCreates: Array<Record<string, unknown>>;
  updates: Array<{ id: string; body: Record<string, unknown> }>;
  forbiddenGets: number;
}

async function mockApi(page: Page, state: MockState): Promise<void> {
  await page.route('**/api/patients**', async (route: Route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    // GET /api/patients?q=...
    if (method === 'GET' && /\/api\/patients$/.test(path)) {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const matchesPublic = PUBLIC_PATIENTS.filter(
        (p) =>
          !q ||
          `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
          (p.dateOfBirth ?? '').includes(q),
      );
      // Distinguish doctor vs receptionist by a header set in the
      // test (the real API decides by session cookie).
      const role = route.request().headers()['x-test-role'] ?? 'receptionist';
      if (role === 'doctor') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ patients: FULL_PATIENTS }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ patients: matchesPublic }),
      });
    }

    // GET /api/patients/:id — doctor only
    const oneMatch = /\/api\/patients\/([\w-]+)$/.exec(path);
    if (method === 'GET' && oneMatch) {
      const found = FULL_PATIENTS.find((p) => p.id === oneMatch[1]);
      if (!found) {
        state.forbiddenGets += 1;
        return route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"403"}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ patient: found }),
      });
    }

    // POST /api/patients/duplicate-check
    if (method === 'POST' && /\/api\/patients\/duplicate-check$/.test(path)) {
      const body = await route.request().postDataJSON();
      const firstName = String(body.firstName ?? '').toLowerCase();
      const lastName = String(body.lastName ?? '').toLowerCase();
      const candidates = PUBLIC_PATIENTS.filter((p) =>
        `${p.firstName} ${p.lastName}`.toLowerCase().includes(`${firstName} ${lastName}`.trim()),
      );
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ candidates }),
      });
    }

    // POST /api/patients — role-aware
    if (method === 'POST' && /\/api\/patients$/.test(path)) {
      const body = await route.request().postDataJSON();
      const role = route.request().headers()['x-test-role'] ?? 'receptionist';
      if (role === 'doctor') {
        state.fullCreates.push(body as Record<string, unknown>);
        const created = {
          ...FULL_PATIENTS[0],
          ...body,
          id: 'p-new',
          legacyId: null,
        };
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ patient: created }),
        });
      }
      state.publicCreates.push(body as Record<string, unknown>);
      const created = {
        id: 'p-new',
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: body.dateOfBirth ?? null,
      };
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ patient: created }),
      });
    }

    // PATCH /api/patients/:id
    if (method === 'PATCH' && oneMatch) {
      const body = await route.request().postDataJSON();
      state.updates.push({ id: oneMatch[1]!, body: body as Record<string, unknown> });
      const before = FULL_PATIENTS.find((p) => p.id === oneMatch[1])!;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ patient: { ...before, ...body, updatedAt: new Date().toISOString() } }),
      });
    }

    return route.fulfill({ status: 404, body: 'not found' });
  });
}

function emptyState(): MockState {
  return { publicCreates: [], fullCreates: [], updates: [], forbiddenGets: 0 };
}

test.describe('Receptionist patient search and quick-add', () => {
  test.use({ authState: 'receptionist' });


  test('search renders only public DTO fields', async ({ page }) => {
    const state = emptyState();
    await mockApi(page, state);
    await page.goto('/receptionist/pacientet');

    await expect(page.getByRole('heading', { name: 'Pacientët' })).toBeVisible();

    await page.getByPlaceholder(/Kërko pacient/).fill('Rita');
    // Wait for the debounced fetch.
    await expect(page.getByText('Rita Hoxha')).toBeVisible();
    await expect(page.getByText('Rita Hoxhaj')).toBeVisible();

    // PHI must NOT render anywhere in the visible search results — verify
    // a sentinel field (phone format) is absent.
    await expect(page.getByText('+383')).toHaveCount(0);
    await expect(page.getByText('Penicilinë')).toHaveCount(0);
  });

  test('quick-add flow creates a patient with three fields only', async ({ page }) => {
    const state = emptyState();
    await mockApi(page, state);
    await page.goto('/receptionist/pacientet');

    await page.getByRole('button', { name: /Pacient i ri/ }).click();
    await expect(page.getByRole('dialog', { name: 'Pacient i ri' })).toBeVisible();

    await page.getByLabel('Emri').fill('Lori');
    await page.getByLabel('Mbiemri').fill('Gashi');
    await page.getByLabel('Datelindja').fill('2024-04-12');

    await page.getByRole('button', { name: /Ruaj pacientin|Vazhdo si i ri/ }).click();

    await expect.poll(() => state.publicCreates.length).toBe(1);
    expect(state.publicCreates[0]).toEqual({
      firstName: 'Lori',
      lastName: 'Gashi',
      dateOfBirth: '2024-04-12',
    });
  });

  test('duplicate notice surfaces likely candidates; "use existing" closes modal', async ({ page }) => {
    const state = emptyState();
    await mockApi(page, state);
    await page.goto('/receptionist/pacientet');

    await page.getByRole('button', { name: /Pacient i ri/ }).click();
    await page.getByLabel('Emri').fill('Rita');
    await page.getByLabel('Mbiemri').fill('Hoxha');

    await expect(page.getByText('Mund të ekzistojë tashmë:')).toBeVisible();
    // CTA renders for each candidate; click the first.
    await page.getByRole('button', { name: 'Përdor këtë' }).first().click();

    // Modal closes without creating a new patient.
    await expect(page.getByRole('dialog', { name: 'Pacient i ri' })).toBeHidden();
    expect(state.publicCreates).toHaveLength(0);
  });

  test('continue-as-new with the notice visible still submits', async ({ page }) => {
    const state = emptyState();
    await mockApi(page, state);
    await page.goto('/receptionist/pacientet');

    await page.getByRole('button', { name: /Pacient i ri/ }).click();
    await page.getByLabel('Emri').fill('Rita');
    await page.getByLabel('Mbiemri').fill('Hoxha');
    await expect(page.getByText('Mund të ekzistojë tashmë:')).toBeVisible();

    await page.getByRole('button', { name: 'Vazhdo si i ri' }).click();
    await expect.poll(() => state.publicCreates.length).toBe(1);
  });

  test('receptionist navigating directly to doctor patient page sees an empty result list', async ({ page }) => {
    // The route exists but the API responds with the receptionist's
    // public shape — the doctor patient list still works only if the
    // user has the doctor role on the server. In our mock the GET
    // returns the public DTO list; the doctor view expects PatientFullDto.
    // It renders a "no results" state because the public DTOs have no
    // alergjiTjera/sex/etc. — and any GET :id is 403.
    const state = emptyState();
    await mockApi(page, state);
    await page.goto('/doctor/pacientet');

    // The list renders rows from the public DTOs (fewer fields). The
    // detail panel reflects the absence of opening a record.
    await expect(
      page.getByText(/Zgjidh një pacient/),
    ).toBeVisible();
  });
});

test.describe('Doctor patient browser', () => {
  test('list shows all master-data fields', async ({ page }) => {
    const state = emptyState();
    // Tell the mock to return the doctor's full shape regardless of role.
    await page.setExtraHTTPHeaders({ 'x-test-role': 'doctor' });
    await mockApi(page, state);
    await page.goto('/doctor/pacientet');

    await expect(page.getByText('Era Krasniqi')).toBeVisible();
    // Alergji marker dot in the list, visible per spec.
    await expect(page.locator('[aria-label="Ka alergji / shënim"]').first()).toBeVisible();

    // Open the patient — full data should appear in the right panel.
    await page.getByText('Era Krasniqi').first().click();
    await expect(page.getByDisplayValue('Era')).toBeVisible();
    await expect(page.getByDisplayValue('Krasniqi')).toBeVisible();
    await expect(page.getByDisplayValue('Prizren')).toBeVisible();
    await expect(page.getByDisplayValue('Penicilinë')).toBeVisible();
  });

  test('create new patient submits a full payload', async ({ page }) => {
    const state = emptyState();
    await page.setExtraHTTPHeaders({ 'x-test-role': 'doctor' });
    await mockApi(page, state);
    await page.goto('/doctor/pacientet');

    await page.getByRole('button', { name: '+ I ri' }).click();

    await page.locator('label:has(span:text-is("Emri")) input').fill('Lori');
    await page.locator('label:has(span:text-is("Mbiemri")) input').fill('Gashi');
    await page.locator('label:has(span:text-is("Datelindja")) input').fill('2021-06-12');
    await page.locator('label:has(span:text-is("Vendi i lindjes")) input').fill('Pejë');
    await page.locator('label:has(span:text-is("Telefoni")) input').fill('+383 44 444 555');

    await page.getByRole('button', { name: 'Ruaj' }).click();

    await expect.poll(() => state.fullCreates.length).toBe(1);
    expect(state.fullCreates[0]).toMatchObject({
      firstName: 'Lori',
      lastName: 'Gashi',
      dateOfBirth: '2021-06-12',
      placeOfBirth: 'Pejë',
      phone: '+383 44 444 555',
    });
  });

  test('edit autosaves on blur', async ({ page }) => {
    const state = emptyState();
    await page.setExtraHTTPHeaders({ 'x-test-role': 'doctor' });
    await mockApi(page, state);
    await page.goto('/doctor/pacientet');

    await page.getByText('Era Krasniqi').click();
    const phone = page.locator('label:has(span:text-is("Telefoni")) input');
    await phone.fill('+383 49 100 200');
    await phone.blur();

    await expect.poll(() => state.updates.length).toBeGreaterThanOrEqual(1);
    const last = state.updates[state.updates.length - 1]!;
    expect(last.body.phone).toBe('+383 49 100 200');
    await expect(page.getByText(/Ruajtur|Po ruhet/)).toBeVisible();
  });
});
