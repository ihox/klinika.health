// Unit tests for Europe/Belgrade local-clock ↔ UTC mapping. Europe/Belgrade
// switches between CET (UTC+1) in winter and CEST (UTC+2) in summer; the
// helpers must agree across the boundary.

import { describe, expect, it } from 'vitest';

import { iterateLocalDays, localClockToUtc, utcToLocalParts, weekdayOf } from './appointments.tz';

describe('localClockToUtc', () => {
  it('uses UTC+2 in May (CEST)', () => {
    const d = localClockToUtc('2026-05-14', '10:30');
    expect(d.toISOString()).toBe('2026-05-14T08:30:00.000Z');
  });

  it('uses UTC+1 in January (CET)', () => {
    const d = localClockToUtc('2026-01-15', '10:30');
    expect(d.toISOString()).toBe('2026-01-15T09:30:00.000Z');
  });

  it('round-trips through utcToLocalParts', () => {
    const inputs: Array<[string, string]> = [
      ['2026-05-14', '10:30'],
      ['2026-01-15', '10:30'],
      ['2026-03-29', '04:30'], // CEST-onset day in Belgrade
      ['2026-10-25', '04:30'], // CET-onset day in Belgrade
    ];
    for (const [date, time] of inputs) {
      const utc = localClockToUtc(date, time);
      const parts = utcToLocalParts(utc);
      expect({ date: parts.date, time: parts.time }).toEqual({ date, time });
    }
  });
});

describe('utcToLocalParts', () => {
  it('renders the weekday correctly', () => {
    expect(utcToLocalParts(new Date('2026-05-14T08:30:00Z')).weekday).toBe('thu');
    expect(utcToLocalParts(new Date('2026-05-17T08:30:00Z')).weekday).toBe('sun');
  });
});

describe('iterateLocalDays', () => {
  it('yields each ISO date in the inclusive range', () => {
    const days = [...iterateLocalDays('2026-05-14', '2026-05-17')];
    expect(days).toEqual(['2026-05-14', '2026-05-15', '2026-05-16', '2026-05-17']);
  });
});

describe('weekdayOf', () => {
  it('returns the correct weekday for a given ISO date', () => {
    expect(weekdayOf('2026-05-14')).toBe('thu');
    expect(weekdayOf('2026-05-17')).toBe('sun');
    expect(weekdayOf('2026-05-18')).toBe('mon');
  });
});
