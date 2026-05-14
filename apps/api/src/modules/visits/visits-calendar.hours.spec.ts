// Unit tests for working-hours helpers.

import { describe, expect, it } from 'vitest';

import type { HoursConfig } from '../clinic-settings/clinic-settings.dto';
import { fitsInsideHours, openWindowForDay, toMinutes } from './visits-calendar.hours';

const DEFAULT_HOURS: HoursConfig = {
  timezone: 'Europe/Belgrade',
  days: {
    mon: { open: true, start: '10:00', end: '18:00' },
    tue: { open: true, start: '10:00', end: '18:00' },
    wed: { open: true, start: '10:00', end: '18:00' },
    thu: { open: true, start: '10:00', end: '18:00' },
    fri: { open: true, start: '09:00', end: '14:00' },
    sat: { open: true, start: '10:00', end: '14:00' },
    sun: { open: false },
  },
  durations: [10, 15, 20],
  defaultDuration: 15,
};

describe('openWindowForDay', () => {
  it('returns null for closed days (Sunday)', () => {
    expect(openWindowForDay(DEFAULT_HOURS, '2026-05-17')).toBeNull();
  });
  it('returns the window for open days', () => {
    expect(openWindowForDay(DEFAULT_HOURS, '2026-05-15')).toEqual({
      date: '2026-05-15',
      start: '09:00',
      end: '14:00',
    });
  });
});

describe('fitsInsideHours', () => {
  it('rejects closed days', () => {
    const r = fitsInsideHours(DEFAULT_HOURS, '2026-05-17', toMinutes('10:00'), 15);
    expect(r.fits).toBe(false);
    expect(r.reason).toBe('closed_day');
  });

  it('rejects appointments before open', () => {
    const r = fitsInsideHours(DEFAULT_HOURS, '2026-05-14', toMinutes('09:30'), 15);
    expect(r.fits).toBe(false);
    expect(r.reason).toBe('before_open');
  });

  it('rejects appointments that overflow closing time', () => {
    const r = fitsInsideHours(DEFAULT_HOURS, '2026-05-14', toMinutes('17:55'), 15);
    expect(r.fits).toBe(false);
    expect(r.reason).toBe('after_close');
  });

  it('accepts an appointment that ends exactly at close', () => {
    const r = fitsInsideHours(DEFAULT_HOURS, '2026-05-14', toMinutes('17:45'), 15);
    expect(r.fits).toBe(true);
  });

  it('accepts a typical mid-day appointment', () => {
    const r = fitsInsideHours(DEFAULT_HOURS, '2026-05-14', toMinutes('11:30'), 15);
    expect(r.fits).toBe(true);
  });
});
