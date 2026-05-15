// Visibility tests for the "Pastro vizitën" button (Phase 2c).
// Mirrors the server-side validation (visits.service.clear.spec.ts) so
// the UI and the API agree on when the button should appear.

import { describe, expect, it } from 'vitest';

import { belgradeToday, canClearVisit } from './visit-clear';

const NOW = new Date('2026-05-15T10:00:00Z'); // 12:00 Belgrade (UTC+2 summer)
const TODAY = belgradeToday(NOW);

function visit(overrides: { status?: string; visitDate?: string } = {}) {
  return {
    status: 'completed',
    visitDate: TODAY,
    ...overrides,
  };
}

describe('canClearVisit', () => {
  it('returns true for a doctor on today + completed', () => {
    expect(canClearVisit(visit(), ['doctor'], NOW)).toBe(true);
  });

  it('returns true for a clinic_admin on today + completed', () => {
    expect(canClearVisit(visit(), ['clinic_admin'], NOW)).toBe(true);
  });

  it('returns true for a doctor + clinic_admin multi-role user', () => {
    expect(canClearVisit(visit(), ['doctor', 'clinic_admin'], NOW)).toBe(true);
  });

  it('returns true even when receptionist is paired with clinical access', () => {
    expect(
      canClearVisit(visit(), ['receptionist', 'clinic_admin'], NOW),
    ).toBe(true);
  });

  it('returns false for a receptionist-only session', () => {
    expect(canClearVisit(visit(), ['receptionist'], NOW)).toBe(false);
  });

  it('returns false for an empty roles array', () => {
    expect(canClearVisit(visit(), [], NOW)).toBe(false);
  });

  it('returns false on a past-day completed visit', () => {
    expect(
      canClearVisit(
        visit({ visitDate: '2026-05-14' }),
        ['doctor'],
        NOW,
      ),
    ).toBe(false);
  });

  it('returns false on a future-day completed visit', () => {
    expect(
      canClearVisit(
        visit({ visitDate: '2026-05-16' }),
        ['doctor'],
        NOW,
      ),
    ).toBe(false);
  });

  it.each([
    'scheduled',
    'arrived',
    'in_progress',
    'no_show',
    'cancelled',
  ])('returns false for status="%s" even on today', (status) => {
    expect(
      canClearVisit(visit({ status }), ['doctor'], NOW),
    ).toBe(false);
  });
});

describe('belgradeToday', () => {
  it('returns yyyy-mm-dd anchored on Europe/Belgrade', () => {
    // 2026-05-15 10:00 UTC = 2026-05-15 12:00 Belgrade (summer, UTC+2)
    expect(belgradeToday(new Date('2026-05-15T10:00:00Z'))).toBe('2026-05-15');
  });

  it('rolls to next local day when UTC is still on the previous calendar date', () => {
    // 2026-05-15 23:30 UTC = 2026-05-16 01:30 Belgrade (summer)
    expect(belgradeToday(new Date('2026-05-15T23:30:00Z'))).toBe('2026-05-16');
  });

  it('stays on local day when UTC is on the next calendar date', () => {
    // 2026-05-16 00:30 UTC = 2026-05-16 02:30 Belgrade — same day Belgrade
    expect(belgradeToday(new Date('2026-05-16T00:30:00Z'))).toBe('2026-05-16');
  });
});
