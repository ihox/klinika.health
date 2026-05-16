// Pure-helper tests for the doctor's global patient search. The full
// click/keyboard flow is covered by the Playwright spec in
// `apps/web/tests/e2e/doctor-home.spec.ts`; this file pins the small
// formatting helper so the dropdown row stays stable.

import { describe, expect, it } from 'vitest';

import { formatAgeAndSex } from './global-patient-search';

// 2026-05-16 is the project's CLAUDE.md "today" — keep the asOf date
// in sync with that so the age math reads naturally next to the
// expected output.
const ASOF = new Date('2026-05-16T12:00:00Z');

describe('formatAgeAndSex', () => {
  it('returns age and sex separated by " · " when both are present', () => {
    expect(
      formatAgeAndSex({ dateOfBirth: '2023-08-03', sex: 'f' }, ASOF),
    ).toBe('2v 9m · vajzë');
    expect(
      formatAgeAndSex({ dateOfBirth: '2022-03-12', sex: 'm' }, ASOF),
    ).toBe('4v 2m · djalë');
  });

  it('returns only age when sex is null (receptionist quick-add)', () => {
    expect(
      formatAgeAndSex({ dateOfBirth: '2023-08-03', sex: null }, ASOF),
    ).toBe('2v 9m');
  });

  it('returns only sex when DOB is null', () => {
    expect(formatAgeAndSex({ dateOfBirth: null, sex: 'f' }, ASOF)).toBe(
      'vajzë',
    );
    expect(formatAgeAndSex({ dateOfBirth: null, sex: 'm' }, ASOF)).toBe(
      'djalë',
    );
  });

  it('returns an empty string when both halves are missing', () => {
    expect(formatAgeAndSex({ dateOfBirth: null, sex: null }, ASOF)).toBe('');
  });

  it('uses Albanian month/day bands for sub-year ages', () => {
    expect(
      formatAgeAndSex({ dateOfBirth: '2025-11-16', sex: 'f' }, ASOF),
    ).toBe('6 muaj · vajzë');
    expect(
      formatAgeAndSex({ dateOfBirth: '2026-04-30', sex: 'm' }, ASOF),
    ).toBe('16 ditë · djalë');
  });
});
