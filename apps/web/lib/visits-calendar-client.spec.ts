// Unit tests for the visits-calendar client's pure helpers — the
// status-transition matrix and entry classification predicates.
//
// Kept narrow on purpose: the wire shapes / fetch wrappers are
// exercised by the API integration tests; only the no-side-effect
// helpers belong here.

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  isScheduledEntry,
  isTransitionAllowed,
  isWalkInEntry,
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
