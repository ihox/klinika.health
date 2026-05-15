// Pure-helper tests for the receptionist calendar client.
//
// Only the timezone-free date helpers belong here. Anything that touches
// `Intl.DateTimeFormat` (e.g. `toLocalParts`) is exercised through the
// integration tests that run against the Europe/Belgrade clock.

import { describe, expect, it } from 'vitest';

import { addLocalDays, mondayOfWeekIso, weekdayOf } from './appointment-client';

describe('mondayOfWeekIso', () => {
  it('returns the same date when given a Monday', () => {
    // 2026-05-11 is a Monday.
    expect(mondayOfWeekIso('2026-05-11')).toBe('2026-05-11');
  });

  it('rolls back mid-week to the prior Monday', () => {
    expect(mondayOfWeekIso('2026-05-13')).toBe('2026-05-11'); // Wed
    expect(mondayOfWeekIso('2026-05-15')).toBe('2026-05-11'); // Fri
  });

  it('rolls back Saturday to the same week Monday', () => {
    expect(mondayOfWeekIso('2026-05-16')).toBe('2026-05-11'); // Sat
  });

  it('treats Sunday as belonging to the previous week', () => {
    // The receptionist calendar never shows Sunday; the design uses
    // Monday-anchored weeks, so the Sunday between two weeks rolls back
    // to the Monday before it (not forward to the next Monday).
    expect(mondayOfWeekIso('2026-05-17')).toBe('2026-05-11'); // Sun
  });

  it('handles month boundaries', () => {
    // 2026-06-01 is a Monday; the prior Sunday is 2026-05-31.
    expect(mondayOfWeekIso('2026-05-31')).toBe('2026-05-25'); // Sun
    expect(mondayOfWeekIso('2026-06-01')).toBe('2026-06-01'); // Mon
  });

  it('is a pure shift of addLocalDays(weekday offset)', () => {
    // Cross-check against the underlying helper. For any date,
    // mondayOfWeekIso(d) === addLocalDays(d, -offsetFromMonday).
    const dates = ['2026-05-11', '2026-05-12', '2026-05-13', '2026-05-14',
      '2026-05-15', '2026-05-16', '2026-05-17'];
    for (const d of dates) {
      const dow = weekdayOf(d);
      const offset = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 }[dow];
      expect(mondayOfWeekIso(d)).toBe(addLocalDays(d, -offset));
    }
  });
});
