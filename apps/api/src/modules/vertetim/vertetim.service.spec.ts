// Unit tests for the pure helpers in `vertetim.service`. The
// integration spec exercises the controller end-to-end against
// Postgres; these tests pin the snapshot + date math without a DB.

import { describe, expect, it } from 'vitest';

import { buildDiagnosisSnapshot, daysInclusive } from './vertetim.service';

describe('buildDiagnosisSnapshot', () => {
  it('uses the primary structured diagnosis when present', () => {
    expect(
      buildDiagnosisSnapshot({
        legacyDiagnosis: 'ignored',
        diagnoses: [
          {
            icd10Code: 'J03.9',
            code: { latinDescription: 'Tonsillitis acuta' },
          },
        ],
      }),
    ).toBe('J03.9 — Tonsillitis acuta');
  });

  it('falls back to the legacy diagnosis when no structured codes', () => {
    expect(
      buildDiagnosisSnapshot({
        legacyDiagnosis: 'Tonsillopharyngitis acuta',
        diagnoses: [],
      }),
    ).toBe('Tonsillopharyngitis acuta');
  });

  it('trims the legacy diagnosis', () => {
    expect(
      buildDiagnosisSnapshot({ legacyDiagnosis: '  abc  ', diagnoses: [] }),
    ).toBe('abc');
  });

  it('returns em-dash when neither structured nor legacy', () => {
    expect(
      buildDiagnosisSnapshot({ legacyDiagnosis: null, diagnoses: [] }),
    ).toBe('—');
    expect(
      buildDiagnosisSnapshot({ legacyDiagnosis: '   ', diagnoses: [] }),
    ).toBe('—');
  });
});

describe('daysInclusive', () => {
  it('returns 1 for the same day', () => {
    expect(daysInclusive('2026-05-14', '2026-05-14')).toBe(1);
  });

  it('counts both endpoints (Mon-Fri = 5)', () => {
    expect(daysInclusive('2026-05-11', '2026-05-15')).toBe(5);
  });

  it('handles month rollovers', () => {
    expect(daysInclusive('2026-04-28', '2026-05-03')).toBe(6);
  });
});
