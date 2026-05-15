// Unit tests for the visits-calendar client's pure helpers — the
// status-transition matrix and entry classification predicates.
//
// Kept narrow on purpose: the wire shapes / fetch wrappers are
// exercised by the API integration tests; only the no-side-effect
// helpers belong here.

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  findClosestPairing,
  isReceptionistOnlyRole,
  isScheduledEntry,
  isTransitionAllowed,
  isVisitLockedForReceptionist,
  isWalkInEntry,
  PAIRABLE_STATUSES,
  VISIT_STATUSES,
  type CalendarEntry,
} from './visits-calendar-client';

describe('VISIT_STATUSES', () => {
  it('includes the full unified lifecycle', () => {
    expect(VISIT_STATUSES).toEqual([
      'scheduled',
      'arrived',
      'in_progress',
      'completed',
      'no_show',
      'cancelled',
    ]);
  });
});

describe('ALLOWED_TRANSITIONS / isTransitionAllowed', () => {
  it('mirrors the server matrix from visits-calendar.status.ts', () => {
    // scheduled may move to arrived / no_show / cancelled
    expect(ALLOWED_TRANSITIONS.scheduled).toContain('arrived');
    expect(ALLOWED_TRANSITIONS.scheduled).toContain('no_show');
    expect(ALLOWED_TRANSITIONS.scheduled).toContain('cancelled');
    // arrived → in_progress | no_show
    expect(ALLOWED_TRANSITIONS.arrived).toContain('in_progress');
    expect(ALLOWED_TRANSITIONS.arrived).toContain('no_show');
    // in_progress → completed
    expect(ALLOWED_TRANSITIONS.in_progress).toEqual(['completed']);
    // completed → arrived only (Phase 2c "Pastro vizitën")
    expect(ALLOWED_TRANSITIONS.completed).toEqual(['arrived']);
    // no_show / cancelled both reopen to arrived
    expect(ALLOWED_TRANSITIONS.no_show).toEqual(['arrived']);
    expect(ALLOWED_TRANSITIONS.cancelled).toEqual(['arrived']);
  });

  it('rejects self-transitions', () => {
    for (const s of VISIT_STATUSES) {
      expect(isTransitionAllowed(s, s)).toBe(false);
    }
  });

  it('rejects scheduled → in_progress (must go through arrived)', () => {
    expect(isTransitionAllowed('scheduled', 'in_progress')).toBe(false);
  });

  it('rejects in_progress → no_show (no rollback that way)', () => {
    expect(isTransitionAllowed('in_progress', 'no_show')).toBe(false);
  });

  it('rejects completed → cancelled (clinical record is closed)', () => {
    expect(isTransitionAllowed('completed', 'cancelled')).toBe(false);
  });

  it('allows the full forward path: scheduled → arrived → in_progress → completed', () => {
    expect(isTransitionAllowed('scheduled', 'arrived')).toBe(true);
    expect(isTransitionAllowed('arrived', 'in_progress')).toBe(true);
    expect(isTransitionAllowed('in_progress', 'completed')).toBe(true);
  });

  it('allows the "Rikthe te paraqitur" reopen from no_show and cancelled', () => {
    expect(isTransitionAllowed('no_show', 'arrived')).toBe(true);
    expect(isTransitionAllowed('cancelled', 'arrived')).toBe(true);
  });
});

describe('isScheduledEntry / isWalkInEntry', () => {
  const base: CalendarEntry = {
    id: 'a',
    patientId: 'p',
    patient: { firstName: 'Era', lastName: 'K', dateOfBirth: '2023-08-03' },
    scheduledFor: null,
    durationMinutes: null,
    arrivedAt: null,
    status: 'scheduled',
    isWalkIn: false,
    paymentCode: null,
    lastVisitAt: null,
    isNewPatient: true,
    createdAt: '2026-05-15T08:00:00Z',
    updatedAt: '2026-05-15T08:00:00Z',
  };

  it('classifies a scheduled (non-walk-in) booking', () => {
    const entry: CalendarEntry = {
      ...base,
      scheduledFor: '2026-05-15T08:30:00Z',
      durationMinutes: 15,
      status: 'scheduled',
      isWalkIn: false,
    };
    expect(isScheduledEntry(entry)).toBe(true);
    expect(isWalkInEntry(entry)).toBe(false);
  });

  it('classifies a walk-in', () => {
    const entry: CalendarEntry = {
      ...base,
      scheduledFor: null,
      durationMinutes: null,
      arrivedAt: '2026-05-15T09:00:00Z',
      status: 'arrived',
      isWalkIn: true,
    };
    expect(isScheduledEntry(entry)).toBe(false);
    expect(isWalkInEntry(entry)).toBe(true);
  });

  it('a walk-in with a defensively-set scheduledFor is still a walk-in (band, not grid)', () => {
    // The server never emits this combo, but the client predicate is
    // defensive: isWalkIn=true wins.
    const entry: CalendarEntry = {
      ...base,
      scheduledFor: '2026-05-15T08:30:00Z',
      durationMinutes: 15,
      isWalkIn: true,
      arrivedAt: '2026-05-15T09:00:00Z',
      status: 'arrived',
    };
    expect(isScheduledEntry(entry)).toBe(false);
    expect(isWalkInEntry(entry)).toBe(true);
  });
});

describe('PAIRABLE_STATUSES', () => {
  // Mirrors the server-side allow-list in visits-calendar.service.ts.
  it('contains exactly scheduled / arrived / in_progress', () => {
    expect([...PAIRABLE_STATUSES].sort()).toEqual(
      ['arrived', 'in_progress', 'scheduled'],
    );
  });
});

describe('findClosestPairing', () => {
  // Test fixture: a minimal-but-realistic scheduled entry. All factory
  // calls inherit these defaults and override what they're exercising.
  const base: CalendarEntry = {
    id: 'a',
    patientId: 'p',
    patient: { firstName: 'Era', lastName: 'K', dateOfBirth: '2023-08-03' },
    scheduledFor: '2026-05-15T08:00:00Z',
    durationMinutes: 15,
    arrivedAt: null,
    status: 'scheduled',
    isWalkIn: false,
    paymentCode: null,
    lastVisitAt: null,
    isNewPatient: true,
    createdAt: '2026-05-15T08:00:00Z',
    updatedAt: '2026-05-15T08:00:00Z',
  };
  const at = (iso: string, overrides: Partial<CalendarEntry> = {}): CalendarEntry => ({
    ...base,
    id: overrides.id ?? iso,
    scheduledFor: iso,
    ...overrides,
  });

  it('returns null when no pairable visits exist', () => {
    expect(findClosestPairing([], Date.now())).toBeNull();
  });

  it('returns null when every entry is a walk-in', () => {
    const walkins: CalendarEntry[] = [
      { ...base, id: 'w', isWalkIn: true, scheduledFor: null, arrivedAt: base.scheduledFor },
    ];
    expect(findClosestPairing(walkins, Date.now())).toBeNull();
  });

  it('skips finalized statuses (completed / no_show / cancelled)', () => {
    const list: CalendarEntry[] = [
      at('2026-05-15T10:00:00Z', { id: 'done', status: 'completed' }),
      at('2026-05-15T11:00:00Z', { id: 'miss', status: 'no_show' }),
      at('2026-05-15T12:00:00Z', { id: 'cncl', status: 'cancelled' }),
    ];
    expect(findClosestPairing(list, Date.parse('2026-05-15T11:00:00Z'))).toBeNull();
  });

  it('prefers the in-flight visit (scheduled_for ≤ now ≤ scheduled_for + duration)', () => {
    // now sits 5 min into the 10:00 booking — the in-flight pick beats
    // the closer 10:30 future booking that "minimum distance" alone
    // would prefer.
    const list: CalendarEntry[] = [
      at('2026-05-15T10:00:00Z', { id: 'in-flight', durationMinutes: 15 }),
      at('2026-05-15T10:30:00Z', { id: 'next', durationMinutes: 15 }),
    ];
    const now = Date.parse('2026-05-15T10:05:00Z');
    const pick = findClosestPairing(list, now);
    expect(pick?.id).toBe('in-flight');
  });

  it('picks the closest scheduled_for to now when nothing is in-flight', () => {
    const list: CalendarEntry[] = [
      at('2026-05-15T08:00:00Z', { id: 'far-past' }),
      at('2026-05-15T10:00:00Z', { id: 'closest' }),
      at('2026-05-15T14:00:00Z', { id: 'far-future' }),
    ];
    const now = Date.parse('2026-05-15T10:20:00Z');
    expect(findClosestPairing(list, now)?.id).toBe('closest');
  });

  it('tie-breaks equal distance by preferring the past slot', () => {
    // Now is exactly between 10:00 and 11:00; "just-passed" wins per
    // CLAUDE.md §13.
    const list: CalendarEntry[] = [
      at('2026-05-15T10:00:00Z', { id: 'past', durationMinutes: 5 }),
      at('2026-05-15T11:00:00Z', { id: 'future', durationMinutes: 5 }),
    ];
    const now = Date.parse('2026-05-15T10:30:00Z');
    expect(findClosestPairing(list, now)?.id).toBe('past');
  });
});

describe('isReceptionistOnlyRole', () => {
  it('locks plain receptionist sessions', () => {
    expect(isReceptionistOnlyRole(['receptionist'])).toBe(true);
  });

  it('does NOT lock receptionist+doctor combos', () => {
    expect(isReceptionistOnlyRole(['receptionist', 'doctor'])).toBe(false);
  });

  it('does NOT lock receptionist+clinic_admin combos', () => {
    expect(isReceptionistOnlyRole(['receptionist', 'clinic_admin'])).toBe(false);
  });

  it('does NOT lock pure doctor or clinic_admin', () => {
    expect(isReceptionistOnlyRole(['doctor'])).toBe(false);
    expect(isReceptionistOnlyRole(['clinic_admin'])).toBe(false);
  });

  it('returns false for empty / null', () => {
    expect(isReceptionistOnlyRole(null)).toBe(false);
    expect(isReceptionistOnlyRole([])).toBe(false);
  });
});

describe('isVisitLockedForReceptionist', () => {
  const today = '2026-05-15';
  const entry = (overrides: Partial<CalendarEntry>): CalendarEntry => ({
    id: 'a',
    patientId: 'p',
    patient: { firstName: 'Era', lastName: 'K', dateOfBirth: '2023-08-03' },
    scheduledFor: null,
    durationMinutes: null,
    arrivedAt: null,
    status: 'scheduled',
    isWalkIn: false,
    paymentCode: null,
    lastVisitAt: null,
    isNewPatient: true,
    createdAt: '2026-05-15T08:00:00Z',
    updatedAt: '2026-05-15T08:00:00Z',
    ...overrides,
  });

  it.each(['scheduled', 'arrived', 'in_progress', 'completed', 'no_show', 'cancelled'] as const)(
    'locks yesterday (%s)',
    (status) => {
      const e = entry({ scheduledFor: '2026-05-14T08:00:00Z', status });
      expect(isVisitLockedForReceptionist(e, today)).toBe(true);
    },
  );

  it('locks today + completed', () => {
    const e = entry({ scheduledFor: '2026-05-15T08:00:00Z', status: 'completed' });
    expect(isVisitLockedForReceptionist(e, today)).toBe(true);
  });

  it.each(['scheduled', 'arrived', 'in_progress', 'no_show', 'cancelled'] as const)(
    'unlocks today (%s)',
    (status) => {
      const e = entry({ scheduledFor: '2026-05-15T08:00:00Z', status });
      expect(isVisitLockedForReceptionist(e, today)).toBe(false);
    },
  );

  it.each(['scheduled', 'arrived', 'completed'] as const)(
    'unlocks tomorrow (%s)',
    (status) => {
      const e = entry({ scheduledFor: '2026-05-16T08:00:00Z', status });
      expect(isVisitLockedForReceptionist(e, today)).toBe(false);
    },
  );

  it('uses arrivedAt for walk-ins (no scheduledFor)', () => {
    const yesterdayWalkIn = entry({
      isWalkIn: true,
      arrivedAt: '2026-05-14T09:00:00Z',
      scheduledFor: null,
      status: 'arrived',
    });
    expect(isVisitLockedForReceptionist(yesterdayWalkIn, today)).toBe(true);
    const todayWalkIn = entry({
      isWalkIn: true,
      arrivedAt: '2026-05-15T09:00:00Z',
      scheduledFor: null,
      status: 'arrived',
    });
    expect(isVisitLockedForReceptionist(todayWalkIn, today)).toBe(false);
  });
});
