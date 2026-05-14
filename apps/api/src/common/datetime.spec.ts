// Unit tests for the DATE-column helpers. We mock the system clock
// because the helpers' contract is "what calendar day is it in
// Belgrade *right now*?", and that answer depends on the wall clock.
//
// All anchor instants are expressed in UTC and cross-referenced with
// their Belgrade-local clock in comments — that way the test stays
// readable when DST flips. Belgrade is UTC+1 (CET, winter) / UTC+2
// (CEST, summer); the changeover happens at 01:00 UTC on the last
// Sunday of March and October.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  localDateOf,
  localDateRange,
  localDateToday,
  localMonthStart,
  utcMidnight,
} from './datetime';

describe('localDateToday', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the Belgrade-local date when host clock is UTC midday', () => {
    // 2026-05-14 12:00 UTC = 14:00 Belgrade (CEST). Same calendar day.
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    expect(localDateToday()).toBe('2026-05-14');
  });

  it('rolls forward when host UTC clock has not yet crossed local midnight', () => {
    // 2026-05-14 23:00 UTC = 01:00 Belgrade on 2026-05-15 (CEST).
    // The Belgrade calendar day is *tomorrow* relative to UTC. This is
    // the "host is UTC but TZ aware" case from the STEP 1 refinements.
    vi.setSystemTime(new Date('2026-05-14T23:00:00Z'));
    expect(localDateToday()).toBe('2026-05-15');
  });

  it('returns today at 23:59 Belgrade on the eve of DST spring-forward', () => {
    // 2026-03-28 22:59 UTC = 23:59 Belgrade (CET, last day before DST).
    vi.setSystemTime(new Date('2026-03-28T22:59:00Z'));
    expect(localDateToday()).toBe('2026-03-28');
  });

  it('returns the new day just after midnight on DST spring-forward', () => {
    // 2026-03-28 23:01 UTC = 00:01 Belgrade on 2026-03-29 (still CET;
    // DST flips at 02:00 local → 03:00 local later that morning).
    vi.setSystemTime(new Date('2026-03-28T23:01:00Z'));
    expect(localDateToday()).toBe('2026-03-29');
  });

  it('returns today at 23:59 Belgrade on the eve of DST fall-back', () => {
    // 2026-10-24 21:59 UTC = 23:59 Belgrade (CEST, last evening before
    // the clock falls back). Belgrade is still UTC+2 here.
    vi.setSystemTime(new Date('2026-10-24T21:59:00Z'));
    expect(localDateToday()).toBe('2026-10-24');
  });

  it('returns the new day just after midnight on DST fall-back', () => {
    // 2026-10-24 22:01 UTC = 00:01 Belgrade on 2026-10-25 (still CEST;
    // DST ends at 03:00 local → 02:00 local later that morning).
    vi.setSystemTime(new Date('2026-10-24T22:01:00Z'));
    expect(localDateToday()).toBe('2026-10-25');
  });

  it('honours an explicit non-default timezone', () => {
    // 2026-05-14 12:00 UTC = 21:00 in Asia/Tokyo (UTC+9). Same day.
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    expect(localDateToday('Asia/Tokyo')).toBe('2026-05-14');
    // Same instant in Pacific/Honolulu (UTC-10) is the previous day.
    expect(localDateToday('Pacific/Honolulu')).toBe('2026-05-14');
    // 2026-05-14 06:00 UTC = 20:00 prior day in Honolulu.
    vi.setSystemTime(new Date('2026-05-14T06:00:00Z'));
    expect(localDateToday('Pacific/Honolulu')).toBe('2026-05-13');
  });
});

describe('localMonthStart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the first of the current Belgrade month', () => {
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    expect(localMonthStart()).toBe('2026-05-01');
  });

  it('rolls into the new month when UTC is on the last day but Belgrade is past midnight', () => {
    // 2026-04-30 23:00 UTC = 01:00 Belgrade on 2026-05-01 (CEST).
    vi.setSystemTime(new Date('2026-04-30T23:00:00Z'));
    expect(localMonthStart()).toBe('2026-05-01');
  });

  it('stays in the prior month before local midnight', () => {
    // 2026-04-30 20:00 UTC = 22:00 Belgrade on 2026-04-30 (CEST).
    vi.setSystemTime(new Date('2026-04-30T20:00:00Z'));
    expect(localMonthStart()).toBe('2026-04-01');
  });
});

describe('localDateRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns string inputs verbatim', () => {
    expect(localDateRange('2026-05-01', '2026-05-14')).toEqual({
      from: '2026-05-01',
      to: '2026-05-14',
    });
  });

  it('reduces Date inputs to Belgrade-local YYYY-MM-DD', () => {
    // Both anchors are *evening UTC*, i.e. already next-day Belgrade.
    const from = new Date('2026-04-30T22:30:00Z'); // 00:30 Belgrade 2026-05-01
    const to = new Date('2026-05-14T22:30:00Z'); // 00:30 Belgrade 2026-05-15
    expect(localDateRange(from, to)).toEqual({
      from: '2026-05-01',
      to: '2026-05-15',
    });
  });

  it('accepts a mix of Date and string', () => {
    const from = new Date('2026-01-15T09:30:00Z'); // 10:30 Belgrade (CET)
    expect(localDateRange(from, '2026-02-01')).toEqual({
      from: '2026-01-15',
      to: '2026-02-01',
    });
  });
});

describe('localDateOf', () => {
  it('handles winter (CET) and summer (CEST) without drift', () => {
    expect(localDateOf(new Date('2026-01-15T09:30:00Z'))).toBe('2026-01-15');
    expect(localDateOf(new Date('2026-05-14T08:30:00Z'))).toBe('2026-05-14');
  });
});

describe('utcMidnight', () => {
  it('returns a Date whose UTC date portion matches the input ISO', () => {
    // The contract Prisma cares about: `toISOString().slice(0, 10)` of
    // the resulting Date equals the input. If we accidentally drifted
    // by a timezone offset, the DATE column comparison would skew.
    for (const iso of ['2026-05-14', '2026-03-29', '2026-10-25', '2026-01-01']) {
      const d = utcMidnight(iso);
      expect(d.toISOString().slice(0, 10)).toBe(iso);
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
    }
  });
});
