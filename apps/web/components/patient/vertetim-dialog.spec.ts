// Unit tests for the vërtetim dialog's pure date helpers. The dialog
// itself renders in the chart E2E (`tests/e2e/print.spec.ts`), which
// exercises the click → API → preview flow with mocks. These tests
// pin the date math without React rendering.

import { describe, expect, it } from 'vitest';

import { addDaysIso, diffDaysInclusive } from './vertetim-dialog';

describe('addDaysIso', () => {
  it('adds days, day-anchored', () => {
    expect(addDaysIso('2026-05-14', 4)).toBe('2026-05-18');
  });

  it('rolls over months / years', () => {
    expect(addDaysIso('2026-04-30', 3)).toBe('2026-05-03');
    expect(addDaysIso('2026-12-30', 5)).toBe('2027-01-04');
  });

  it('handles 0 day shifts', () => {
    expect(addDaysIso('2026-05-14', 0)).toBe('2026-05-14');
  });
});

describe('diffDaysInclusive', () => {
  it('returns 1 for the same day (Sot)', () => {
    expect(diffDaysInclusive('2026-05-14', '2026-05-14')).toBe(1);
  });

  it('returns 5 for a Mon → Fri inclusive range', () => {
    expect(diffDaysInclusive('2026-05-11', '2026-05-15')).toBe(5);
  });

  it('returns 7 for "1 javë" (today + 6 = +6 days = 7 inclusive)', () => {
    expect(diffDaysInclusive('2026-05-14', addDaysIso('2026-05-14', 6))).toBe(7);
  });

  it('crosses month boundaries', () => {
    expect(diffDaysInclusive('2026-04-28', '2026-05-03')).toBe(6);
  });
});
