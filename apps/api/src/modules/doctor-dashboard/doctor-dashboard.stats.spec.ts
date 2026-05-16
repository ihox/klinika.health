import { describe, expect, it } from 'vitest';

import {
  averageVisitMinutes,
  computeDayStats,
} from './doctor-dashboard.stats';

describe('averageVisitMinutes', () => {
  it('returns null when fewer than 2 visits exist', () => {
    expect(averageVisitMinutes([])).toBeNull();
    expect(
      averageVisitMinutes([{ paymentCode: 'A', createdAt: new Date() }]),
    ).toBeNull();
  });

  it('returns the mean gap between successive visit saves', () => {
    const t0 = Date.UTC(2026, 4, 14, 10, 0);
    const result = averageVisitMinutes([
      { paymentCode: 'A', createdAt: new Date(t0) },
      { paymentCode: 'A', createdAt: new Date(t0 + 10 * 60_000) },
      { paymentCode: 'A', createdAt: new Date(t0 + 22 * 60_000) },
      { paymentCode: 'A', createdAt: new Date(t0 + 36 * 60_000) },
    ]);
    // gaps 10, 12, 14 → mean 12
    expect(result).toBe(12);
  });

  it('caps each gap at 4 hours so lunch breaks do not skew the average', () => {
    const t0 = Date.UTC(2026, 4, 14, 10, 0);
    const result = averageVisitMinutes([
      { paymentCode: 'A', createdAt: new Date(t0) },
      // 9-hour gap (lunch) — should be capped to 240 minutes
      { paymentCode: 'A', createdAt: new Date(t0 + 9 * 60 * 60_000) },
      { paymentCode: 'A', createdAt: new Date(t0 + 9 * 60 * 60_000 + 10 * 60_000) },
    ]);
    // gaps capped: 240, 10 → mean 125
    expect(result).toBe(125);
  });

  it('sorts unsorted input before computing gaps', () => {
    const t0 = Date.UTC(2026, 4, 14, 10, 0);
    const result = averageVisitMinutes([
      { paymentCode: 'A', createdAt: new Date(t0 + 30 * 60_000) },
      { paymentCode: 'A', createdAt: new Date(t0) },
      { paymentCode: 'A', createdAt: new Date(t0 + 15 * 60_000) },
    ]);
    // sorted gaps 15, 15 → mean 15
    expect(result).toBe(15);
  });
});

describe('computeDayStats', () => {
  const paymentAmount = (code: string): number | null => {
    const map: Record<string, number> = { A: 1500, B: 1000, E: 0 };
    return code in map ? (map[code] as number) : null;
  };

  it('sums payments across visits, ignoring unknown codes', () => {
    const t0 = Date.UTC(2026, 4, 14, 10, 0);
    const result = computeDayStats({
      visits: [
        { paymentCode: 'A', createdAt: new Date(t0) },
        { paymentCode: 'A', createdAt: new Date(t0 + 10 * 60_000) },
        { paymentCode: 'B', createdAt: new Date(t0 + 20 * 60_000) },
        // Unknown code — should not error or contribute.
        { paymentCode: 'Z', createdAt: new Date(t0 + 30 * 60_000) },
        // No code — zero contribution.
        { paymentCode: null, createdAt: new Date(t0 + 40 * 60_000) },
      ],
      // Clinical-scope day total — 8 visits today (5 completed above
      // + 3 non-completed, e.g. scheduled / in_progress / no_show).
      dayTotalCount: 8,
      paymentAmount,
    });
    expect(result.paymentsCents).toBe(1500 + 1500 + 1000);
    expect(result.visitsCompleted).toBe(5);
    expect(result.appointmentsTotal).toBe(8);
    // appointmentsCompleted equals visitsCompleted by construction.
    expect(result.appointmentsCompleted).toBe(5);
    expect(result.averageVisitMinutes).toBe(10);
  });

  it('returns zero payments and null average for an empty day', () => {
    const result = computeDayStats({
      visits: [],
      dayTotalCount: 0,
      paymentAmount,
    });
    expect(result).toEqual({
      visitsCompleted: 0,
      appointmentsTotal: 0,
      appointmentsCompleted: 0,
      averageVisitMinutes: null,
      paymentsCents: 0,
    });
  });

  it('appointmentsTotal reflects the clinical-scope day count, not visits.length', () => {
    const t0 = Date.UTC(2026, 4, 14, 10, 0);
    // Only 2 completed visits today, but 7 total in clinical scope —
    // appointmentsTotal must reflect the day count, not the completed
    // subset.
    const result = computeDayStats({
      visits: [
        { paymentCode: 'A', createdAt: new Date(t0) },
        { paymentCode: 'A', createdAt: new Date(t0 + 10 * 60_000) },
      ],
      dayTotalCount: 7,
      paymentAmount,
    });
    expect(result.visitsCompleted).toBe(2);
    expect(result.appointmentsTotal).toBe(7);
    expect(result.appointmentsCompleted).toBe(2);
  });
});
