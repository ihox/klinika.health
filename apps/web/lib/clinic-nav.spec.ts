import { describe, expect, it } from 'vitest';

import {
  appBarTitle,
  grantedNavItems,
  isNavItemActive,
  NAV_ITEMS,
  splitBottomTabs,
} from './clinic-nav';

/**
 * The mobile nav derives its tabs from this same §5.8 model as the
 * desktop nav (confirmed product decision: mobile must not diverge from
 * the canonical role→menu mapping). These tests pin that contract.
 */
describe('clinic-nav — §5.8 role→menu derivation', () => {
  const labels = (roles: Parameters<typeof grantedNavItems>[0]) =>
    grantedNavItems(roles).map((i) => i.label);

  it('pure doctor: Pamja e ditës · Pacientët · Raporti (no Cilësimet/Kalendari)', () => {
    expect(labels(['doctor'])).toEqual(['Pamja e ditës', 'Pacientët', 'Raporti']);
  });

  it('pure receptionist: Kalendari · Raporti only (NO Pacientët, NO Cilësimet)', () => {
    expect(labels(['receptionist'])).toEqual(['Kalendari', 'Raporti']);
  });

  it('pure clinic_admin: Cilësimet · Raporti only (NO Pacientët)', () => {
    expect(labels(['clinic_admin'])).toEqual(['Raporti', 'Cilësimet']);
  });

  it('multi-role doctor + clinic_admin sees the union, in fixed display order', () => {
    // Dr. Taulant — the prototype "doctor" view's real shape.
    expect(labels(['doctor', 'clinic_admin'])).toEqual([
      'Pamja e ditës',
      'Pacientët',
      'Raporti',
      'Cilësimet',
    ]);
  });

  it('display order is fixed regardless of role array order', () => {
    expect(labels(['clinic_admin', 'doctor'])).toEqual(labels(['doctor', 'clinic_admin']));
  });

  it('no roles → no items', () => {
    expect(grantedNavItems([])).toEqual([]);
  });
});

describe('clinic-nav — bottom-tab split (max 3 primary + overflow)', () => {
  it('doctor (3 granted) → all primary, empty overflow', () => {
    const { primary, overflow } = splitBottomTabs(grantedNavItems(['doctor']));
    expect(primary.map((i) => i.label)).toEqual(['Pamja e ditës', 'Pacientët', 'Raporti']);
    expect(overflow).toEqual([]);
  });

  it('doctor + clinic_admin (4 granted) → 3 primary + Cilësimet in overflow', () => {
    const { primary, overflow } = splitBottomTabs(grantedNavItems(['doctor', 'clinic_admin']));
    expect(primary.map((i) => i.label)).toEqual(['Pamja e ditës', 'Pacientët', 'Raporti']);
    expect(overflow.map((i) => i.label)).toEqual(['Cilësimet']);
  });

  it('receptionist (2 granted) → both primary, empty overflow', () => {
    const { primary, overflow } = splitBottomTabs(grantedNavItems(['receptionist']));
    expect(primary.map((i) => i.label)).toEqual(['Kalendari', 'Raporti']);
    expect(overflow).toEqual([]);
  });
});

describe('clinic-nav — active state', () => {
  const pacientet = NAV_ITEMS.find((i) => i.key === 'pacientet')!;

  it('lights Pacientët on the chart + master-data sub-routes', () => {
    expect(isNavItemActive(pacientet, '/pacient/abc-123')).toBe(true);
    expect(isNavItemActive(pacientet, '/pacient/abc/te-dhena')).toBe(true);
    expect(isNavItemActive(pacientet, '/doctor/pacientet')).toBe(true);
    expect(isNavItemActive(pacientet, '/pacientet')).toBe(true);
  });

  it('does not light Pacientët on unrelated routes', () => {
    expect(isNavItemActive(pacientet, '/raporti')).toBe(false);
    // /pacienteve must not match /pacientet as a bare prefix.
    expect(isNavItemActive(pacientet, '/raportize')).toBe(false);
  });
});

describe('clinic-nav — app bar title', () => {
  const doctorItems = grantedNavItems(['doctor']);

  it('uses the active item label', () => {
    expect(appBarTitle(doctorItems, '/doctor')).toBe('Pamja e ditës');
    expect(appBarTitle(doctorItems, '/pacient/abc')).toBe('Pacientët');
  });

  it('returns "Profili im" on the profile route', () => {
    expect(appBarTitle(doctorItems, '/profili-im')).toBe('Profili im');
  });

  it('falls back to the brand on an unmatched route', () => {
    expect(appBarTitle(doctorItems, '/something-else')).toBe('Klinika');
  });
});
