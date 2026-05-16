// Unit tests for the receptionist calendar's status filter helpers.
// The visual pill row is wired into calendar-view.tsx and verified
// manually; the helpers below carry the filtering logic and are
// exercised here in isolation.

import { describe, expect, it } from 'vitest';

import type { CalendarEntry, VisitStatus } from '@/lib/visits-calendar-client';
import {
  countByStatusFilter,
  entryMatchesStatusFilter,
} from './status-filters';

function entry(id: string, status: VisitStatus): CalendarEntry {
  return {
    id,
    patientId: `p-${id}`,
    patient: { firstName: 'Era', lastName: 'K', dateOfBirth: '2023-08-03' },
    scheduledFor: '2026-05-15T08:00:00Z',
    durationMinutes: 15,
    arrivedAt: null,
    status,
    isWalkIn: false,
    paymentCode: null,
    lastVisitAt: null,
    isNewPatient: true,
    createdAt: '2026-05-15T08:00:00Z',
    updatedAt: '2026-05-15T08:00:00Z',
  };
}

describe('entryMatchesStatusFilter', () => {
  it('"all" matches every status', () => {
    for (const s of ['scheduled', 'arrived', 'in_progress', 'completed', 'no_show'] as const) {
      expect(entryMatchesStatusFilter(entry('x', s), 'all')).toBe(true);
    }
  });

  it('"scheduled" matches the in-pipeline trio (scheduled / arrived / in_progress)', () => {
    expect(entryMatchesStatusFilter(entry('a', 'scheduled'), 'scheduled')).toBe(true);
    expect(entryMatchesStatusFilter(entry('b', 'arrived'), 'scheduled')).toBe(true);
    expect(entryMatchesStatusFilter(entry('c', 'in_progress'), 'scheduled')).toBe(true);
    // finalized statuses are excluded
    expect(entryMatchesStatusFilter(entry('d', 'completed'), 'scheduled')).toBe(false);
    expect(entryMatchesStatusFilter(entry('e', 'no_show'), 'scheduled')).toBe(false);
  });

  it('terminal-status filters match only their exact status', () => {
    expect(entryMatchesStatusFilter(entry('a', 'completed'), 'completed')).toBe(true);
    expect(entryMatchesStatusFilter(entry('b', 'arrived'), 'completed')).toBe(false);

    expect(entryMatchesStatusFilter(entry('c', 'no_show'), 'no_show')).toBe(true);
    expect(entryMatchesStatusFilter(entry('d', 'scheduled'), 'no_show')).toBe(false);
  });
});

describe('countByStatusFilter', () => {
  const entries: CalendarEntry[] = [
    entry('a', 'scheduled'),
    entry('b', 'scheduled'),
    entry('c', 'arrived'),
    entry('d', 'in_progress'),
    entry('e', 'completed'),
    entry('f', 'completed'),
    entry('g', 'no_show'),
    entry('h', 'no_show'),
  ];

  it('"all" equals the total entries length', () => {
    expect(countByStatusFilter(entries).all).toBe(entries.length);
  });

  it('collapses the in-pipeline statuses under "scheduled"', () => {
    expect(countByStatusFilter(entries).scheduled).toBe(4);
  });

  it('counts each terminal status separately', () => {
    const counts = countByStatusFilter(entries);
    expect(counts.completed).toBe(2);
    expect(counts.no_show).toBe(2);
  });

  it('handles an empty input', () => {
    expect(countByStatusFilter([])).toEqual({
      all: 0,
      scheduled: 0,
      completed: 0,
      no_show: 0,
    });
  });
});
