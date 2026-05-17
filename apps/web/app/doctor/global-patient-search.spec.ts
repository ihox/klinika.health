// Pure-helper tests for the second-line meta on top-nav search rows.
// Both the doctor's ⌘K dropdown and the receptionist's top-bar share
// `formatDobAndPlace` so the two surfaces stay visually identical;
// pinning the helper here keeps the row stable for both. The full
// click/keyboard flow is covered by the Playwright spec in
// `apps/web/tests/e2e/doctor-home.spec.ts`.

import { describe, expect, it } from 'vitest';

import { formatDobAndPlace } from '@/lib/patient-client';

describe('formatDobAndPlace', () => {
  it('joins DOB and place with " · " when both are present', () => {
    expect(formatDobAndPlace('2024-02-12', 'Prizren')).toBe('12.02.2024 · Prizren');
  });

  it('omits the separator when place is missing', () => {
    expect(formatDobAndPlace('2024-02-12', null)).toBe('12.02.2024');
  });

  it('treats an empty/whitespace place as missing', () => {
    expect(formatDobAndPlace('2024-02-12', '')).toBe('12.02.2024');
    expect(formatDobAndPlace('2024-02-12', '   ')).toBe('12.02.2024');
  });

  it('renders "DL pa caktuar" when DOB is null (sentinel mapped at DTO boundary)', () => {
    // The 1900-01-01 sentinel arrives as null on the wire — see
    // `patients.dto.ts#dateToIso`. The helper only sees null.
    expect(formatDobAndPlace(null, 'Prizren')).toBe('DL pa caktuar');
  });

  it('renders "DL pa caktuar" when both DOB and place are missing', () => {
    expect(formatDobAndPlace(null, null)).toBe('DL pa caktuar');
  });
});
