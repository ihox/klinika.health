// Unit tests for the walk-in band's pure grouping helper.
//
// The visual rendering is exercised by Playwright E2E + manual smoke;
// here we only assert that the bucket-by-local-day logic respects
// Europe/Belgrade boundaries and orders chips by arrival time.

import { describe, expect, it } from 'vitest';

import type { CalendarEntry } from '@/lib/visits-calendar-client';
import { groupWalkInsByDay } from './walk-in-band';

function walkin(id: string, arrivedAtIso: string, status: CalendarEntry['status'] = 'arrived'): CalendarEntry {
  return {
    id,
    patientId: `p-${id}`,
    patient: { firstName: id, lastName: 'Test', dateOfBirth: '2023-08-03' },
    scheduledFor: null,
    durationMinutes: null,
    arrivedAt: arrivedAtIso,
    status,
    isWalkIn: true,
    paymentCode: null,
    lastVisitAt: null,
    isNewPatient: true,
    createdAt: arrivedAtIso,
    updatedAt: arrivedAtIso,
  };
}

function scheduled(id: string, scheduledForIso: string): CalendarEntry {
  return {
    id,
    patientId: `p-${id}`,
    patient: { firstName: id, lastName: 'Test', dateOfBirth: '2023-08-03' },
    scheduledFor: scheduledForIso,
    durationMinutes: 15,
    arrivedAt: null,
    status: 'scheduled',
    isWalkIn: false,
    paymentCode: null,
    lastVisitAt: null,
    isNewPatient: true,
    createdAt: scheduledForIso,
    updatedAt: scheduledForIso,
  };
}

describe('groupWalkInsByDay', () => {
  it('returns an empty map when there are no walk-ins', () => {
    const map = groupWalkInsByDay([]);
    expect(map.size).toBe(0);
  });

  it('skips scheduled (non-walk-in) entries even when passed in', () => {
    const map = groupWalkInsByDay([
      scheduled('s1', '2026-05-15T08:30:00Z'),
    ]);
    expect(map.size).toBe(0);
  });

  it('buckets walk-ins by their local Belgrade date (CEST = UTC+2 in May)', () => {
    // 21:30 UTC on 2026-05-14 == 23:30 local on 2026-05-14
    const earlier = walkin('a', '2026-05-14T21:30:00Z');
    // 22:30 UTC on 2026-05-14 == 00:30 local on 2026-05-15
    const later = walkin('b', '2026-05-14T22:30:00Z');
    const map = groupWalkInsByDay([earlier, later]);
    expect([...map.keys()].sort()).toEqual(['2026-05-14', '2026-05-15']);
    expect(map.get('2026-05-14')!.map((e) => e.id)).toEqual(['a']);
    expect(map.get('2026-05-15')!.map((e) => e.id)).toEqual(['b']);
  });

  it('sorts walk-ins within a bucket by arrived_at ascending', () => {
    const c = walkin('c', '2026-05-15T11:47:00Z');
    const a = walkin('a', '2026-05-15T08:12:00Z');
    const b = walkin('b', '2026-05-15T10:00:00Z');
    const map = groupWalkInsByDay([c, a, b]);
    expect(map.get('2026-05-15')!.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to createdAt when arrivedAt is missing', () => {
    const e: CalendarEntry = {
      ...walkin('x', '2026-05-15T09:00:00Z'),
      arrivedAt: null,
      createdAt: '2026-05-15T07:00:00Z',
    };
    const map = groupWalkInsByDay([e]);
    expect(map.size).toBe(1);
    expect([...map.keys()][0]).toBe('2026-05-15');
  });
});
