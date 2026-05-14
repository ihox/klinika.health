// Unit tests for the chart-builder pure helpers. The integration
// spec covers the controller wiring end-to-end against Postgres; the
// helpers below are extracted so we can pin date math without a DB.

import { describe, expect, it } from 'vitest';

import {
  buildGrowthPoints,
  computeDaysSince,
  daysInclusive,
  dateToIso,
  monthsBetween,
} from './patient-chart.service';

describe('computeDaysSince', () => {
  it('returns null when there is no prior visit', () => {
    expect(computeDaysSince(null, new Date('2026-05-14T11:00:00Z'))).toBeNull();
  });

  it('counts whole calendar days between visit date and today', () => {
    expect(
      computeDaysSince(
        new Date('2026-04-01T00:00:00Z'),
        new Date('2026-05-14T11:00:00Z'),
      ),
    ).toBe(43);
  });

  it('returns 0 when the visit happened today regardless of time of day', () => {
    expect(
      computeDaysSince(
        new Date('2026-05-14T07:00:00Z'),
        new Date('2026-05-14T17:00:00Z'),
      ),
    ).toBe(0);
  });

  it('clamps to zero when the visit is in the future', () => {
    expect(
      computeDaysSince(
        new Date('2026-06-01T00:00:00Z'),
        new Date('2026-05-14T00:00:00Z'),
      ),
    ).toBe(0);
  });
});

describe('daysInclusive', () => {
  it('treats single-day ranges as 1 day', () => {
    const same = new Date('2026-05-14T00:00:00Z');
    expect(daysInclusive(same, same)).toBe(1);
  });

  it('counts both endpoints (Mon-Fri = 5 days)', () => {
    expect(
      daysInclusive(
        new Date('2026-05-11T00:00:00Z'),
        new Date('2026-05-15T00:00:00Z'),
      ),
    ).toBe(5);
  });

  it('handles month rollovers', () => {
    expect(
      daysInclusive(
        new Date('2026-04-28T00:00:00Z'),
        new Date('2026-05-03T00:00:00Z'),
      ),
    ).toBe(6);
  });
});

describe('dateToIso', () => {
  it('serialises a Date column to a yyyy-mm-dd string', () => {
    expect(dateToIso(new Date('2026-05-14T00:00:00Z'))).toBe('2026-05-14');
  });
});

// ---------------------------------------------------------------------------
// monthsBetween — drives the growth-chart x-axis
// ---------------------------------------------------------------------------

describe('monthsBetween', () => {
  it('returns 0 on the day of birth', () => {
    expect(
      monthsBetween(
        new Date('2024-08-15T00:00:00Z'),
        new Date('2024-08-15T00:00:00Z'),
      ),
    ).toBe(0);
  });

  it('returns 0 for visits that pre-date the DOB (defensive)', () => {
    expect(
      monthsBetween(
        new Date('2024-08-15T00:00:00Z'),
        new Date('2024-08-14T00:00:00Z'),
      ),
    ).toBe(0);
  });

  it('uses calendar arithmetic, not a 30-day approximation', () => {
    expect(
      monthsBetween(
        new Date('2024-01-31T00:00:00Z'),
        new Date('2025-01-31T00:00:00Z'),
      ),
    ).toBe(12);
    // The day before the anniversary is still 11 months.
    expect(
      monthsBetween(
        new Date('2024-01-31T00:00:00Z'),
        new Date('2025-01-30T00:00:00Z'),
      ),
    ).toBe(11);
  });
});

// ---------------------------------------------------------------------------
// buildGrowthPoints — projects visits into a sex-agnostic series
// ---------------------------------------------------------------------------

describe('buildGrowthPoints', () => {
  const dob = new Date('2024-01-15T00:00:00Z');

  it('returns an empty list when the patient has no DOB', () => {
    expect(
      buildGrowthPoints(null, [
        {
          id: 'v1',
          visitDate: new Date('2025-01-15T00:00:00Z'),
          createdAt: new Date('2025-01-15T00:00:00Z'),
          weightG: 9500,
          heightCm: null,
          headCircumferenceCm: null,
        },
      ]),
    ).toEqual([]);
  });

  it('skips visits with no measurements at all', () => {
    const pts = buildGrowthPoints(dob, [
      {
        id: 'v1',
        visitDate: new Date('2025-01-15T00:00:00Z'),
        createdAt: new Date('2025-01-15T00:00:00Z'),
        weightG: null,
        heightCm: null,
        headCircumferenceCm: null,
      },
    ]);
    expect(pts).toEqual([]);
  });

  it('keeps visits with at least one measurement and converts to chart units', () => {
    const pts = buildGrowthPoints(dob, [
      {
        id: 'v1',
        visitDate: new Date('2025-01-15T00:00:00Z'),
        createdAt: new Date('2025-01-15T00:00:00Z'),
        weightG: 9500,
        heightCm: { toString: () => '74.5' },
        headCircumferenceCm: { toString: () => '45.0' },
      },
    ]);
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({
      visitId: 'v1',
      ageMonths: 12,
      weightKg: 9.5,
      heightCm: 74.5,
      headCircumferenceCm: 45,
    });
  });

  it('emits points oldest-first regardless of input order', () => {
    const pts = buildGrowthPoints(dob, [
      // The chart service hands us newest-first; the builder must
      // reverse so the time-axis plot reads left-to-right.
      {
        id: 'v2',
        visitDate: new Date('2025-07-15T00:00:00Z'),
        createdAt: new Date('2025-07-15T00:00:00Z'),
        weightG: 10500,
        heightCm: null,
        headCircumferenceCm: null,
      },
      {
        id: 'v1',
        visitDate: new Date('2024-04-15T00:00:00Z'),
        createdAt: new Date('2024-04-15T00:00:00Z'),
        weightG: 7000,
        heightCm: null,
        headCircumferenceCm: null,
      },
    ]);
    expect(pts.map((p) => p.visitId)).toEqual(['v1', 'v2']);
  });
});
