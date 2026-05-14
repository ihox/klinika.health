import { describe, expect, it } from 'vitest';

import { orderRoles, roleLabel, ROLE_DISPLAY_ORDER, ROLE_LABELS } from './role-labels';

describe('role-labels — canonical Albanian copy', () => {
  it('exposes the canonical labels referenced in CLAUDE.md §5.8', () => {
    expect(ROLE_LABELS.doctor).toBe('Mjeku');
    expect(ROLE_LABELS.receptionist).toBe('Recepsioniste');
    expect(ROLE_LABELS.clinic_admin).toBe('Administrator i klinikës');
    expect(ROLE_LABELS.platform_admin).toBe('Administrator i platformës');
  });

  it('roleLabel returns the canonical label', () => {
    expect(roleLabel('doctor')).toBe('Mjeku');
    expect(roleLabel('receptionist')).toBe('Recepsioniste');
    expect(roleLabel('clinic_admin')).toBe('Administrator i klinikës');
  });

  it('orders clinic roles doctor → receptionist → clinic_admin regardless of input order', () => {
    expect(orderRoles(['clinic_admin', 'doctor'])).toEqual(['doctor', 'clinic_admin']);
    expect(orderRoles(['receptionist', 'doctor', 'clinic_admin'])).toEqual([
      'doctor',
      'receptionist',
      'clinic_admin',
    ]);
  });

  it('appends platform_admin after the clinic roles', () => {
    expect(orderRoles(['platform_admin'])).toEqual(['platform_admin']);
    expect(orderRoles(['platform_admin', 'doctor'])).toEqual(['doctor', 'platform_admin']);
  });

  it('returns an empty array for empty input', () => {
    expect(orderRoles([])).toEqual([]);
  });

  it('the canonical clinic display order is exactly the three roles', () => {
    expect(ROLE_DISPLAY_ORDER).toEqual(['doctor', 'receptionist', 'clinic_admin']);
  });
});
