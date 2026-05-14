// Unit tests for the chart-builder pure helpers. The integration
// spec covers the controller wiring end-to-end against Postgres; the
// helpers below are extracted so we can pin date math without a DB.

import { describe, expect, it } from 'vitest';

import {
  computeDaysSince,
  daysInclusive,
  dateToIso,
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
