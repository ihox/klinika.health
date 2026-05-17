// Unit-tests for the chart shell's visit-picking helpers.
//
// These two helpers express the architectural rule from the same-
// patient guard fix: the chart should mount on today's active visit
// (scheduled / arrived / in_progress) when one exists, and the chart
// otherwise falls back to the most-recent row. They're plain functions
// because the chart-view's auto-select effect and "+ Vizitë e re"
// gating both read the same predicate — pinning the rule once here
// keeps both surfaces in lockstep.

import { describe, expect, it } from 'vitest';

import { findActiveVisitToday, pickInitialVisit } from './chart-view';
import type { ChartVisitDto } from '@/lib/patient-client';

const TODAY = '2026-05-16';
const YESTERDAY = '2026-05-15';

function visit(overrides: Partial<ChartVisitDto>): ChartVisitDto {
  return {
    id: 'v',
    visitDate: TODAY,
    status: 'completed',
    primaryDiagnosis: null,
    legacyDiagnosis: null,
    paymentCode: null,
    updatedAt: '2026-05-16T08:00:00Z',
    ...overrides,
  };
}

describe('findActiveVisitToday', () => {
  it.each(['scheduled', 'arrived', 'in_progress'] as const)(
    'returns today\'s %s visit',
    (status) => {
      const v = visit({ id: 'today-active', status });
      expect(findActiveVisitToday([v], TODAY)).toBe(v);
    },
  );

  it('returns null when the only today row is completed (legitimate follow-up case)', () => {
    const v = visit({ id: 'today-done', status: 'completed' });
    expect(findActiveVisitToday([v], TODAY)).toBeNull();
  });

  it('returns null for a no_show row today (non-active terminal status)', () => {
    const v = visit({ id: 'today-terminal', status: 'no_show' });
    expect(findActiveVisitToday([v], TODAY)).toBeNull();
  });

  it('ignores active visits on other days (scheduled tomorrow does NOT count)', () => {
    const v = visit({ id: 'tomorrow', visitDate: '2026-05-17', status: 'scheduled' });
    expect(findActiveVisitToday([v], TODAY)).toBeNull();
  });

  it('ignores yesterday\'s in_progress visits (should not happen in practice but stays safe)', () => {
    const v = visit({ id: 'yesterday', visitDate: YESTERDAY, status: 'in_progress' });
    expect(findActiveVisitToday([v], TODAY)).toBeNull();
  });

  it('returns null on an empty list', () => {
    expect(findActiveVisitToday([], TODAY)).toBeNull();
  });

  it('prefers the first matching row when more than one is present', () => {
    // The chart bundle is sorted newest-first by (visitDate, createdAt);
    // when two same-day active rows somehow co-exist the first wins so
    // the doctor lands on the more-recent one.
    const first = visit({ id: 'first', status: 'scheduled' });
    const second = visit({ id: 'second', status: 'arrived' });
    expect(findActiveVisitToday([first, second], TODAY)).toBe(first);
  });
});

describe('pickInitialVisit', () => {
  it('prefers today\'s active visit over the newest row', () => {
    // Chart bundle ordering: completed-today created at 09:00 is listed
    // BEFORE scheduled-today at 14:00 only when createdAt is later. The
    // ordering doesn't matter for the helper — it scans by status.
    const completedToday = visit({ id: 'done', status: 'completed' });
    const scheduledToday = visit({ id: 'pending', status: 'scheduled' });
    expect(pickInitialVisit([completedToday, scheduledToday], TODAY).id).toBe('pending');
  });

  it('falls back to the newest row when no active-today exists', () => {
    const newest = visit({ id: 'a', status: 'completed' });
    const older = visit({
      id: 'b',
      status: 'completed',
      visitDate: YESTERDAY,
    });
    expect(pickInitialVisit([newest, older], TODAY).id).toBe('a');
  });

  it('falls back to the newest row when patient only has past completed visits', () => {
    // Legitimate follow-up case: doctor opens a returning patient's
    // chart. No active visit yet — the most-recent completed row is
    // the most useful default selection.
    const today = visit({ id: 'today-done', status: 'completed' });
    const past = visit({
      id: 'past-done',
      status: 'completed',
      visitDate: YESTERDAY,
    });
    expect(pickInitialVisit([today, past], TODAY).id).toBe('today-done');
  });
});
