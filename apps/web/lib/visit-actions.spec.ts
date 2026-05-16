import { describe, expect, it } from 'vitest';

import {
  canCompleteVisit,
  canRevertStatus,
  hasClinicalAccess,
} from './visit-actions';
import type { VisitDto } from './visit-client';

// 2026-05-15 10:00 Belgrade (UTC+2). The predicates anchor on the
// clinic-local day; using a fixed `now` keeps the tests deterministic
// regardless of host TZ.
const NOW = new Date('2026-05-15T08:00:00Z');
const TODAY = '2026-05-15';
const YESTERDAY = '2026-05-14';

function visit(overrides: Partial<VisitDto> = {}): Pick<VisitDto, 'status' | 'visitDate'> {
  return {
    status: overrides.status ?? 'completed',
    visitDate: overrides.visitDate ?? TODAY,
  };
}

describe('hasClinicalAccess', () => {
  it.each(['doctor', 'clinic_admin'])('is true for %s', (role) => {
    expect(hasClinicalAccess([role])).toBe(true);
  });

  it('is true when the user combines clinical + reception roles', () => {
    expect(hasClinicalAccess(['receptionist', 'doctor'])).toBe(true);
    expect(hasClinicalAccess(['receptionist', 'clinic_admin'])).toBe(true);
  });

  it('is false for receptionist alone or no roles', () => {
    expect(hasClinicalAccess(['receptionist'])).toBe(false);
    expect(hasClinicalAccess([])).toBe(false);
  });
});

describe('canCompleteVisit', () => {
  it.each(['arrived', 'in_progress'] as const)(
    'allows completion from %s for a doctor',
    (status) => {
      expect(canCompleteVisit(visit({ status }), ['doctor'])).toBe(true);
    },
  );

  it('refuses receptionist-only sessions even when status is active', () => {
    expect(canCompleteVisit(visit({ status: 'arrived' }), ['receptionist'])).toBe(false);
  });

  it.each(['scheduled', 'completed', 'no_show'] as const)(
    'refuses completion from %s',
    (status) => {
      expect(canCompleteVisit(visit({ status }), ['doctor'])).toBe(false);
    },
  );
});

describe('canRevertStatus', () => {
  it("allows revert on today's completed visit for a doctor", () => {
    expect(canRevertStatus(visit(), ['doctor'], NOW)).toBe(true);
  });

  it("allows revert on today's completed visit for clinic_admin", () => {
    expect(canRevertStatus(visit(), ['clinic_admin'], NOW)).toBe(true);
  });

  it('refuses revert on a past-day completed visit even for the doctor', () => {
    expect(
      canRevertStatus(visit({ visitDate: YESTERDAY }), ['doctor'], NOW),
    ).toBe(false);
  });

  it.each(['scheduled', 'arrived', 'in_progress', 'no_show'] as const)(
    'refuses revert from %s',
    (status) => {
      expect(canRevertStatus(visit({ status }), ['doctor'], NOW)).toBe(false);
    },
  );

  it('refuses revert for receptionist-only sessions', () => {
    expect(canRevertStatus(visit(), ['receptionist'], NOW)).toBe(false);
  });
});
