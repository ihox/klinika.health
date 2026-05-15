import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isVisitLockedForReceptionist } from './visits-calendar.lock';

// Pin "now" to a known Belgrade-local instant. 2026-05-15 12:00 CEST is
// 2026-05-15 10:00 UTC (DST in effect). Choosing midday keeps all
// "today/yesterday/tomorrow" comparisons away from the midnight edge
// so the test's intent stays unambiguous.
const FIXED_NOW = new Date('2026-05-15T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

// Helper: build a minimal lockable row whose visit_date matches a
// `YYYY-MM-DD` string. Mirrors how Prisma returns `@db.Date` rows —
// the UTC parts of the Date carry the local date (ADR-006).
function visit(dateIso: string, status: string) {
  return { visitDate: new Date(`${dateIso}T00:00:00Z`), status };
}

describe('isVisitLockedForReceptionist', () => {
  describe('past day → locked regardless of status', () => {
    it.each([
      'scheduled',
      'arrived',
      'in_progress',
      'completed',
      'no_show',
      'cancelled',
    ])('locks yesterday + %s', (status) => {
      expect(isVisitLockedForReceptionist(visit('2026-05-14', status))).toBe(true);
    });

    it('locks any earlier day', () => {
      expect(isVisitLockedForReceptionist(visit('2026-04-01', 'scheduled'))).toBe(true);
      expect(isVisitLockedForReceptionist(visit('2020-01-01', 'completed'))).toBe(true);
    });
  });

  describe('today → locked only when completed', () => {
    it('locks today + completed', () => {
      expect(isVisitLockedForReceptionist(visit('2026-05-15', 'completed'))).toBe(true);
    });

    it.each(['scheduled', 'arrived', 'in_progress', 'no_show', 'cancelled'])(
      'unlocks today + %s',
      (status) => {
        expect(isVisitLockedForReceptionist(visit('2026-05-15', status))).toBe(false);
      },
    );
  });

  describe('future day → unlocked', () => {
    it.each([
      'scheduled',
      'arrived',
      'in_progress',
      'completed',
      'no_show',
      'cancelled',
    ])('unlocks tomorrow + %s', (status) => {
      expect(isVisitLockedForReceptionist(visit('2026-05-16', status))).toBe(false);
    });

    it('unlocks far-future days', () => {
      expect(isVisitLockedForReceptionist(visit('2027-01-01', 'completed'))).toBe(false);
    });
  });

  describe('midnight transition (Europe/Belgrade)', () => {
    it('flips today→yesterday at 00:00 local — a scheduled row at 23:55 stays editable until midnight', () => {
      // 23:55 Belgrade local on 2026-05-15 == 21:55 UTC same day (DST).
      vi.setSystemTime(new Date('2026-05-15T21:55:00Z'));
      // The not-yet-completed row on today is unlocked.
      expect(isVisitLockedForReceptionist(visit('2026-05-15', 'scheduled'))).toBe(false);

      // Roll past midnight Belgrade-local → 22:00 UTC → 00:00 next day local.
      vi.setSystemTime(new Date('2026-05-15T22:00:00Z'));
      // Same row, now yesterday → locked.
      expect(isVisitLockedForReceptionist(visit('2026-05-15', 'scheduled'))).toBe(true);
    });
  });

  describe('input shape tolerance', () => {
    it('accepts a YYYY-MM-DD string verbatim', () => {
      expect(isVisitLockedForReceptionist({ visitDate: '2026-05-14', status: 'arrived' })).toBe(true);
      expect(isVisitLockedForReceptionist({ visitDate: '2026-05-15', status: 'completed' })).toBe(true);
      expect(isVisitLockedForReceptionist({ visitDate: '2026-05-16', status: 'completed' })).toBe(false);
    });
  });
});
