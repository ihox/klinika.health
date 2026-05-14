import { describe, expect, it } from 'vitest';

import { homePathForRoles } from './auth-client';

describe('homePathForRoles — login redirect priority', () => {
  it('routes platform admins to /admin', () => {
    expect(homePathForRoles(['platform_admin'])).toBe('/admin');
  });

  it('routes a sole doctor to /doctor', () => {
    expect(homePathForRoles(['doctor'])).toBe('/doctor');
  });

  it('routes a sole clinic_admin to /cilesimet', () => {
    expect(homePathForRoles(['clinic_admin'])).toBe('/cilesimet');
  });

  it('routes a sole receptionist to /receptionist', () => {
    expect(homePathForRoles(['receptionist'])).toBe('/receptionist');
  });

  it('prefers doctor when the user holds both doctor and clinic_admin', () => {
    expect(homePathForRoles(['doctor', 'clinic_admin'])).toBe('/doctor');
    expect(homePathForRoles(['clinic_admin', 'doctor'])).toBe('/doctor');
  });

  it('prefers clinic_admin over receptionist when doctor is absent', () => {
    // The smoke test step "Erëblirë (receptionist + clinic_admin)
    // lands on /cilesimet" exercises exactly this branch.
    expect(homePathForRoles(['receptionist', 'clinic_admin'])).toBe('/cilesimet');
  });

  it('routes receptionist last among clinic roles', () => {
    expect(homePathForRoles(['receptionist'])).toBe('/receptionist');
  });

  it('platform admin beats every clinic role on the apex login flow', () => {
    expect(homePathForRoles(['platform_admin', 'doctor'])).toBe('/admin');
  });

  it('falls back to /profili-im when the roles array is empty (degenerate)', () => {
    expect(homePathForRoles([])).toBe('/profili-im');
  });
});
