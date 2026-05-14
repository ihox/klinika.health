import { describe, expect, it } from 'vitest';

import { hasClinicalAccess, isReceptionistOnly, primaryRoleForDisplay } from './role-helpers';

describe('role-helpers', () => {
  describe('hasClinicalAccess', () => {
    it('is true for a sole doctor', () => {
      expect(hasClinicalAccess(['doctor'])).toBe(true);
    });

    it('is true for a sole clinic_admin', () => {
      expect(hasClinicalAccess(['clinic_admin'])).toBe(true);
    });

    it('is true when the user has multiple roles including doctor', () => {
      expect(hasClinicalAccess(['doctor', 'clinic_admin'])).toBe(true);
      expect(hasClinicalAccess(['doctor', 'receptionist'])).toBe(true);
    });

    it('is false for a sole receptionist', () => {
      expect(hasClinicalAccess(['receptionist'])).toBe(false);
    });

    it('is false for an empty array', () => {
      expect(hasClinicalAccess([])).toBe(false);
    });

    it('is false for null / undefined', () => {
      expect(hasClinicalAccess(null)).toBe(false);
      expect(hasClinicalAccess(undefined)).toBe(false);
    });

    it('is false for platform_admin alone (no clinic-scope access)', () => {
      expect(hasClinicalAccess(['platform_admin'])).toBe(false);
    });
  });

  describe('isReceptionistOnly', () => {
    it('is true for a sole receptionist', () => {
      expect(isReceptionistOnly(['receptionist'])).toBe(true);
    });

    it('is false when receptionist also has doctor — doctor wins', () => {
      expect(isReceptionistOnly(['receptionist', 'doctor'])).toBe(false);
    });

    it('is false when receptionist also has clinic_admin — admin wins', () => {
      expect(isReceptionistOnly(['receptionist', 'clinic_admin'])).toBe(false);
    });

    it('is false for a sole doctor or sole clinic_admin', () => {
      expect(isReceptionistOnly(['doctor'])).toBe(false);
      expect(isReceptionistOnly(['clinic_admin'])).toBe(false);
    });

    it('is false for empty / null / undefined', () => {
      expect(isReceptionistOnly([])).toBe(false);
      expect(isReceptionistOnly(null)).toBe(false);
      expect(isReceptionistOnly(undefined)).toBe(false);
    });
  });

  describe('primaryRoleForDisplay', () => {
    it('prefers doctor over everything', () => {
      expect(primaryRoleForDisplay(['doctor'])).toBe('doctor');
      expect(primaryRoleForDisplay(['doctor', 'receptionist'])).toBe('doctor');
      expect(primaryRoleForDisplay(['doctor', 'clinic_admin'])).toBe('doctor');
      expect(primaryRoleForDisplay(['doctor', 'receptionist', 'clinic_admin'])).toBe('doctor');
    });

    it('prefers clinic_admin over receptionist when doctor is absent', () => {
      expect(primaryRoleForDisplay(['clinic_admin'])).toBe('clinic_admin');
      expect(primaryRoleForDisplay(['receptionist', 'clinic_admin'])).toBe('clinic_admin');
    });

    it('returns receptionist when it is the only role', () => {
      expect(primaryRoleForDisplay(['receptionist'])).toBe('receptionist');
    });

    it('falls back to doctor for empty / null / undefined', () => {
      expect(primaryRoleForDisplay([])).toBe('doctor');
      expect(primaryRoleForDisplay(null)).toBe('doctor');
      expect(primaryRoleForDisplay(undefined)).toBe('doctor');
    });
  });
});
