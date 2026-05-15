// Unit tests for the pure helpers powering the receptionist calendar's
// per-column two-lane layout. Visual behavior (the divider, the
// lane-hint, the right-lane positioning) is covered by the manual
// smoke check + (future) Playwright; here we lock down the data shape
// and the per-status height table.

import { describe, expect, it } from 'vitest';

import type { CalendarEntry, VisitStatus } from '@/lib/visits-calendar-client';
import { VISIT_STATUSES } from '@/lib/visits-calendar-client';
import {
  WALKIN_HEIGHT_PX,
  classifyEntriesByGrid,
  groupWalkInsByDay,
} from './calendar-grid';
import { timeToMinutes, toLocalParts } from '@/lib/appointment-client';

function walkin(
  id: string,
  arrivedAtIso: string | null,
  status: CalendarEntry['status'] = 'arrived',
  createdAtIso = arrivedAtIso ?? '2026-05-14T08:00:00.000Z',
): CalendarEntry {
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
    createdAt: createdAtIso,
    updatedAt: createdAtIso,
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
    expect(groupWalkInsByDay([]).size).toBe(0);
  });

  it('skips scheduled (non-walk-in) entries even when passed in', () => {
    const map = groupWalkInsByDay([scheduled('s1', '2026-05-15T08:30:00Z')]);
    expect(map.size).toBe(0);
  });

  it('buckets walk-ins by local Belgrade date (CEST = UTC+2 in May)', () => {
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
    const e = walkin('x', null, 'arrived', '2026-05-15T07:00:00.000Z');
    const map = groupWalkInsByDay([e]);
    expect(map.size).toBe(1);
    expect([...map.keys()][0]).toBe('2026-05-15');
  });

  it('mixes scheduled and walk-in arrays without leaking scheduled rows', () => {
    const s = scheduled('s1', '2026-05-14T08:00:00.000Z');
    const w = walkin('w1', '2026-05-14T10:00:00.000Z');
    const map = groupWalkInsByDay([s, w]);
    expect([...map.values()].flat().map((e) => e.id)).toEqual(['w1']);
  });
});

describe('classifyEntriesByGrid', () => {
  // Grid open 10:00–18:00 == 600..1080 minutes
  const gridStart = 600;
  const gridEnd = 1080;
  const localMin = (iso: string): number =>
    timeToMinutes(toLocalParts(new Date(iso)).time);

  it('marks in-band entries with pinned=null', () => {
    const e = scheduled('s1', '2026-05-15T08:30:00.000Z'); // 10:30 local CEST
    const out = classifyEntriesByGrid(
      [e],
      (x) => (x.scheduledFor ? localMin(x.scheduledFor) : null),
      gridStart,
      gridEnd,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.pinned).toBeNull();
  });

  it('pins an early walk-in to the top of the column', () => {
    // 09:02 local CEST → 07:02 UTC
    const w = walkin('w1', '2026-05-15T07:02:00.000Z');
    const out = classifyEntriesByGrid(
      [w],
      (x) => {
        const iso = x.arrivedAt ?? x.createdAt;
        return iso ? localMin(iso) : null;
      },
      gridStart,
      gridEnd,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.pinned).toEqual({ kind: 'before', offsetPx: 0 });
  });

  it('stacks multiple early visits chronologically at the top', () => {
    // 08:30 local → 06:30 UTC, 09:15 local → 07:15 UTC
    const early = walkin('a', '2026-05-15T06:30:00.000Z');
    const earlier = walkin('b', '2026-05-15T07:15:00.000Z');
    const out = classifyEntriesByGrid(
      [earlier, early],
      (x) => {
        const iso = x.arrivedAt ?? x.createdAt;
        return iso ? localMin(iso) : null;
      },
      gridStart,
      gridEnd,
    );
    // After sort: a (08:30) at offset 0, b (09:15) at offset 24
    expect(out.map((c) => c.entry.id)).toEqual(['a', 'b']);
    expect(out[0]!.pinned).toEqual({ kind: 'before', offsetPx: 0 });
    expect(out[1]!.pinned).toEqual({ kind: 'before', offsetPx: 24 });
  });

  it('pins late visits to the bottom with latest at offset 0', () => {
    // 18:30 local → 16:30 UTC, 19:30 local → 17:30 UTC
    const lateA = walkin('a', '2026-05-15T16:30:00.000Z');
    const lateB = walkin('b', '2026-05-15T17:30:00.000Z');
    const out = classifyEntriesByGrid(
      [lateA, lateB],
      (x) => {
        const iso = x.arrivedAt ?? x.createdAt;
        return iso ? localMin(iso) : null;
      },
      gridStart,
      gridEnd,
    );
    expect(out.map((c) => c.entry.id)).toEqual(['a', 'b']);
    // a (earlier of the two late ones) at the top of the bottom stack;
    // b (latest) at the very bottom.
    expect(out[0]!.pinned).toEqual({ kind: 'after', offsetPx: 24 });
    expect(out[1]!.pinned).toEqual({ kind: 'after', offsetPx: 0 });
  });
});

describe('WALKIN_HEIGHT_PX', () => {
  it('reserves extra room for the in_progress badge', () => {
    expect(WALKIN_HEIGHT_PX.in_progress).toBe(36);
  });

  it('keeps every other status at the compact 24px height', () => {
    const compactStatuses: VisitStatus[] = [
      'arrived',
      'completed',
      'no_show',
      'cancelled',
      'scheduled',
    ];
    for (const s of compactStatuses) {
      expect(WALKIN_HEIGHT_PX[s]).toBe(24);
    }
  });

  it('covers every status in VISIT_STATUSES (no silent fallbacks)', () => {
    for (const s of VISIT_STATUSES) {
      expect(WALKIN_HEIGHT_PX[s]).toBeGreaterThan(0);
    }
  });
});
