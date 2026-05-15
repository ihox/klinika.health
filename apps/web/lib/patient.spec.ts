import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  chartPath,
  isPatientComplete,
  masterDataPath,
  navigateToPatient,
  safeNavigateToPatient,
} from './patient';
import { ApiError } from './api';
import { patientClient, type PatientFullDto } from './patient-client';

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

describe('chartPath / masterDataPath', () => {
  it('builds the chart URL', () => {
    expect(chartPath('abc-123')).toBe('/pacient/abc-123');
  });
  it('builds the master-data URL', () => {
    expect(masterDataPath('abc-123')).toBe('/pacient/abc-123/te-dhena');
  });
});

describe('navigateToPatient', () => {
  let getOneSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getOneSpy = vi.spyOn(patientClient, 'getOne');
  });

  afterEach(() => {
    getOneSpy.mockRestore();
  });

  function patient(overrides: Partial<PatientFullDto>): PatientFullDto {
    return {
      id: 'p-1',
      clinicId: 'c-1',
      legacyId: null,
      firstName: 'Era',
      lastName: 'Krasniqi',
      dateOfBirth: '2023-08-03',
      sex: 'f',
      placeOfBirth: null,
      phone: null,
      birthWeightG: null,
      birthLengthCm: null,
      birthHeadCircumferenceCm: null,
      alergjiTjera: null,
      lastVisitAt: null,
      createdAt: '2024-01-15T10:00:00Z',
      updatedAt: '2024-01-15T10:00:00Z',
      isComplete: true,
      ...overrides,
    };
  }

  it('routes a complete patient to the chart', async () => {
    getOneSpy.mockResolvedValue({ patient: patient({ id: 'p-1', isComplete: true }) });
    const router = { push: vi.fn() };
    await navigateToPatient(router, 'p-1');
    expect(router.push).toHaveBeenCalledWith('/pacient/p-1');
  });

  it('routes an incomplete patient to the master-data form', async () => {
    getOneSpy.mockResolvedValue({ patient: patient({ id: 'p-1', isComplete: false }) });
    const router = { push: vi.fn() };
    await navigateToPatient(router, 'p-1');
    expect(router.push).toHaveBeenCalledWith('/pacient/p-1/te-dhena');
  });

  it('propagates non-401 ApiErrors so the caller can handle them', async () => {
    getOneSpy.mockRejectedValue(new ApiError(404, { message: 'gone' }, 'gone'));
    const router = { push: vi.fn() };
    await expect(navigateToPatient(router, 'p-1')).rejects.toBeInstanceOf(ApiError);
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('safeNavigateToPatient', () => {
  let getOneSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getOneSpy = vi.spyOn(patientClient, 'getOne');
  });

  afterEach(() => {
    getOneSpy.mockRestore();
  });

  it('swallows non-401 errors', async () => {
    getOneSpy.mockRejectedValue(new ApiError(500, { message: 'oops' }, 'oops'));
    const router = { push: vi.fn() };
    // Should NOT throw — the click handler stays put on error.
    await expect(safeNavigateToPatient(router, 'p-1')).resolves.toBeUndefined();
    expect(router.push).not.toHaveBeenCalled();
  });
});

