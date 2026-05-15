import { describe, expect, it } from 'vitest';

import { isPatientComplete } from './patient';

describe('isPatientComplete', () => {
  it('returns true when all four fields are present', () => {
    expect(
      isPatientComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'f',
      }),
    ).toBe(true);
  });

  it('returns false when firstName is missing', () => {
    expect(
      isPatientComplete({
        firstName: '',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'f',
      }),
    ).toBe(false);
    expect(
      isPatientComplete({
        firstName: null,
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'f',
      }),
    ).toBe(false);
  });

  it('returns false when lastName is empty (receptionist quick-add)', () => {
    expect(
      isPatientComplete({
        firstName: 'Era',
        lastName: '',
        dateOfBirth: '2023-08-03',
        sex: 'f',
      }),
    ).toBe(false);
  });

  it('returns false when dateOfBirth is null', () => {
    expect(
      isPatientComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: null,
        sex: 'f',
      }),
    ).toBe(false);
  });

  it('returns false when sex is missing', () => {
    expect(
      isPatientComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: null,
      }),
    ).toBe(false);
    expect(
      isPatientComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: '',
      }),
    ).toBe(false);
  });

  it('returns false on a completely empty record', () => {
    expect(isPatientComplete({})).toBe(false);
  });

  it('accepts the PatientFullDto shape (string fields, nullable DOB/sex)', () => {
    expect(
      isPatientComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'm',
      }),
    ).toBe(true);
  });
});
