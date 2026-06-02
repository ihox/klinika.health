import { expect, test } from './fixtures/auth';
import type { Route } from '@playwright/test';

/**
 * Mobile + tablet navigation (handoff Phase 1). Verifies the adaptive
 * nav presentations per breakpoint and — critically — the receptionist
 * privacy boundary: the mobile UI must not surface any path the §5.8
 * role mapping doesn't grant, and receptionist search is lookup-only
 * (no route to a patient chart, which is doctor/clinic_admin-only).
 */

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 900, height: 1200 };

function mockSearch(patients: Array<Record<string, unknown>>) {
  return (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ patients }),
    });
}

const SAMPLE_PATIENTS = [
  {
    id: '11111111-1111-4000-8000-000000000001',
    firstName: 'Erëza',
    lastName: 'Berisha',
    dateOfBirth: '2020-03-12',
    placeOfBirth: 'Prizren',
    lastVisitAt: null,
    isComplete: true,
  },
];

test.describe('phone — doctor', () => {
  test.use({ authState: 'doctor', viewport: PHONE });

  test('bottom tab bar shows doctor tabs; desktop nav hidden', async ({ page }) => {
    await page.goto('/doctor');
    const tabbar = page.getByRole('navigation', { name: 'Navigimi kryesor' });
    await expect(tabbar).toBeVisible();
    await expect(tabbar.getByText('Sot', { exact: true })).toBeVisible();
    await expect(tabbar.getByText('Pacientët', { exact: true })).toBeVisible();
    await expect(tabbar.getByText('Raporti', { exact: true })).toBeVisible();
    await expect(tabbar.getByText('Më shumë', { exact: true })).toBeVisible();
    // The desktop horizontal nav is CSS-hidden below 1280.
    await expect(page.getByRole('navigation', { name: 'Menu kryesore' })).toBeHidden();
  });

  test('search icon opens the bottom sheet; doctor results are navigable', async ({ page }) => {
    await page.route('**/api/patients?**', mockSearch(SAMPLE_PATIENTS));
    await page.goto('/doctor');
    await page.getByRole('button', { name: 'Kërko' }).click();
    const sheet = page.getByTestId('mobile-search-sheet');
    await expect(sheet).toBeVisible();
    await page.getByPlaceholder('Emër ose datëlindje').fill('Berisha');
    // Doctor results render as navigable buttons.
    await expect(page.getByTestId('mobile-search-result').first()).toBeVisible();
    await expect(sheet.getByText('Erëza Berisha')).toBeVisible();
  });

  test('"Më shumë" sheet exposes profile + logout', async ({ page }) => {
    await page.goto('/doctor');
    await page
      .getByRole('navigation', { name: 'Navigimi kryesor' })
      .getByText('Më shumë', { exact: true })
      .click();
    const sheet = page.getByTestId('mobile-more-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Profili im')).toBeVisible();
    await expect(sheet.getByText('Dilni')).toBeVisible();
  });
});

test.describe('phone — receptionist (privacy boundary)', () => {
  test.use({ authState: 'receptionist', viewport: PHONE });

  test('bottom tabs are Kalendari · Raporti · Më shumë — NO Pacientët', async ({ page }) => {
    await page.goto('/receptionist');
    const tabbar = page.getByRole('navigation', { name: 'Navigimi kryesor' });
    await expect(tabbar).toBeVisible();
    await expect(tabbar.getByText('Kalendari', { exact: true })).toBeVisible();
    await expect(tabbar.getByText('Raporti', { exact: true })).toBeVisible();
    await expect(tabbar.getByText('Më shumë', { exact: true })).toBeVisible();
    // §5.8 + §1.2: receptionist is never granted a Pacientët destination.
    await expect(tabbar.getByText('Pacientët', { exact: true })).toHaveCount(0);
  });

  test('search results are lookup-only — not navigable to a chart', async ({ page }) => {
    await page.route('**/api/patients?**', mockSearch(SAMPLE_PATIENTS));
    await page.goto('/receptionist');
    await page.getByRole('button', { name: 'Kërko' }).click();
    await expect(page.getByTestId('mobile-search-sheet')).toBeVisible();
    await page.getByPlaceholder('Emër ose datëlindje').fill('Berisha');
    // The result is shown (name + DOB) but rendered non-interactive:
    // there is no receptionist patient-detail route (chart is doctor-only).
    await expect(page.getByTestId('mobile-search-sheet').getByText('Erëza Berisha')).toBeVisible();
    await expect(page.getByTestId('mobile-search-result')).toHaveCount(0);
  });
});

test.describe('tablet — doctor', () => {
  test.use({ authState: 'doctor', viewport: TABLET });

  test('enlarged top nav shows; no bottom tab bar', async ({ page }) => {
    await page.goto('/doctor');
    // Tablet top nav carries the search button + the same role links.
    await expect(page.getByRole('button', { name: /Kërko pacient/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigimi kryesor' })).toBeHidden();
  });
});
