import { describe, expect, it } from 'vitest';

import {
  isOnFiveMinuteMark,
  snapTimeStringToFiveMinutes,
  snapToFiveMinutes,
} from './datetime';

describe('snapToFiveMinutes', () => {
  it('returns the same instant when already on a 5-minute mark', () => {
    const exact = new Date('2026-05-15T10:35:00.000Z');
    expect(snapToFiveMinutes(exact).toISOString()).toBe(exact.toISOString());
  });

  it('rounds down when within 2 minutes of the prior mark', () => {
    const drifted = new Date('2026-05-15T10:36:30.000Z');
    expect(snapToFiveMinutes(drifted).toISOString()).toBe(
      '2026-05-15T10:35:00.000Z',
    );
  });

  it('rounds up when past the midpoint', () => {
    const drifted = new Date('2026-05-15T10:38:00.000Z');
    expect(snapToFiveMinutes(drifted).toISOString()).toBe(
      '2026-05-15T10:40:00.000Z',
    );
  });
});

describe('snapTimeStringToFiveMinutes', () => {
  it('passes through exact 5-minute marks', () => {
    expect(snapTimeStringToFiveMinutes('10:35')).toBe('10:35');
    expect(snapTimeStringToFiveMinutes('00:00')).toBe('00:00');
  });

  it('rounds 10:02 to 10:00', () => {
    expect(snapTimeStringToFiveMinutes('10:02')).toBe('10:00');
  });

  it('rounds 10:03 to 10:05', () => {
    expect(snapTimeStringToFiveMinutes('10:03')).toBe('10:05');
  });

  it('rounds 10:58 to 11:00 across the hour boundary', () => {
    expect(snapTimeStringToFiveMinutes('10:58')).toBe('11:00');
  });
});

describe('isOnFiveMinuteMark', () => {
  it.each(['10:00', '10:05', '10:55', '23:55'])('accepts %s', (t) => {
    expect(isOnFiveMinuteMark(t)).toBe(true);
  });

  it.each(['10:01', '10:02', '10:03', '10:04'])('rejects %s', (t) => {
    expect(isOnFiveMinuteMark(t)).toBe(false);
  });
});
