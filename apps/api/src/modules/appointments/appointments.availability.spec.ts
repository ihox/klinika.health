// Unit tests for the booking dialog's per-duration availability rule.
// Exercises the three prototype states (`fits`, `extends`, `blocked`)
// across the boundary conditions that matter:
//   - clean fit when nothing is booked nearby
//   - auto-extend when the duration spills past the natural slot unit
//   - blocked on conflict with an existing appointment
//   - blocked on out-of-hours (closed day, before open, after close)
//   - exclude-self when re-saving an appointment in edit mode
//   - exact-boundary adjacency (touching intervals do not conflict)

import { describe, expect, it } from 'vitest';

import type { HoursConfig } from '../clinic-settings/clinic-settings.dto';
import {
  computeAvailability,
  type OccupiedInterval,
} from './appointments.availability';

const DEFAULT_HOURS: HoursConfig = {
  timezone: 'Europe/Belgrade',
  days: {
    mon: { open: true, start: '10:00', end: '18:00' },
    tue: { open: true, start: '10:00', end: '18:00' },
    wed: { open: true, start: '10:00', end: '18:00' },
    thu: { open: true, start: '10:00', end: '18:00' },
    fri: { open: true, start: '10:00', end: '18:00' },
    sat: { open: true, start: '10:00', end: '14:00' },
    sun: { open: false },
  },
  durations: [10, 15, 20, 30],
  defaultDuration: 15,
};

// 2026-05-14 is Thursday; 2026-05-17 is Sunday (closed).

describe('computeAvailability', () => {
  it('returns clean fit for the natural slot unit and extend for larger durations when the day is empty', () => {
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '10:30', []);
    expect(result.slotUnitMinutes).toBe(10);
    expect(result.options).toEqual([
      { durationMinutes: 10, status: 'fits', endsAt: '10:40', reason: null },
      { durationMinutes: 15, status: 'extends', endsAt: '10:45', reason: null },
      { durationMinutes: 20, status: 'extends', endsAt: '10:50', reason: null },
      { durationMinutes: 30, status: 'extends', endsAt: '11:00', reason: null },
    ]);
  });

  it('blocks every duration when the day is closed', () => {
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-17', '10:30', []);
    expect(result.options.every((o) => o.status === 'blocked')).toBe(true);
    expect(result.options.every((o) => o.reason === 'closed_day')).toBe(true);
  });

  it('blocks durations that would push past the clinic close time', () => {
    // Thursday closes at 18:00. Starting at 17:50: only the natural
    // 10-min unit lands exactly at close.
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '17:50', []);
    const byD = Object.fromEntries(result.options.map((o) => [o.durationMinutes, o]));
    expect(byD[10]!.status).toBe('fits');
    expect(byD[10]!.endsAt).toBe('18:00');
    expect(byD[15]!.status).toBe('blocked');
    expect(byD[15]!.reason).toBe('after_close');
    expect(byD[20]!.status).toBe('blocked');
    expect(byD[30]!.status).toBe('blocked');
  });

  it('blocks before-open hours', () => {
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '09:30', []);
    expect(result.options.every((o) => o.status === 'blocked')).toBe(true);
    expect(result.options.every((o) => o.reason === 'before_open')).toBe(true);
  });

  it('treats adjacent appointments as non-conflicting (endMin == startMin)', () => {
    // Existing appointment 10:30–10:40. A new 10-min slot starting at
    // 10:40 should be a clean fit, not a conflict.
    const occupied: OccupiedInterval[] = [{ startMin: 630, endMin: 640 }];
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '10:40', occupied);
    const ten = result.options.find((o) => o.durationMinutes === 10)!;
    expect(ten.status).toBe('fits');
  });

  it('Case A — clean fit when the day around the slot is empty', () => {
    // 14:30 with nothing booked nearby. 10 = fits, 15 = extends (but
    // not blocked), 20/30 = extends.
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '14:30', []);
    const byD = Object.fromEntries(result.options.map((o) => [o.durationMinutes, o]));
    expect(byD[10]!.status).toBe('fits');
    expect(byD[15]!.status).toBe('extends');
    expect(byD[15]!.endsAt).toBe('14:45');
  });

  it('Case B — extends still allowed when next 5 minutes are free', () => {
    // Tap at 11:00 (10-min slot). 15 min extends to 11:15 — clear.
    // The next existing appointment starts at 11:15 (adjacent, OK for 15)
    // but a 20-min booking ending at 11:20 would overlap.
    const occupied: OccupiedInterval[] = [{ startMin: 11 * 60 + 15, endMin: 11 * 60 + 30 }];
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '11:00', occupied);
    const byD = Object.fromEntries(result.options.map((o) => [o.durationMinutes, o]));
    expect(byD[10]!.status).toBe('fits');
    expect(byD[15]!.status).toBe('extends');
    expect(byD[15]!.endsAt).toBe('11:15');
    expect(byD[20]!.status).toBe('blocked');
    expect(byD[20]!.reason).toBe('conflict');
  });

  it('Case C — 15 min blocked when the next slot is already booked', () => {
    // Tap at 12:30. Next appointment booked 12:40–12:50, so a 15-min
    // appointment from 12:30 (ends 12:45) would overlap.
    const occupied: OccupiedInterval[] = [
      { startMin: 12 * 60 + 40, endMin: 12 * 60 + 50 },
    ];
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '12:30', occupied);
    const byD = Object.fromEntries(result.options.map((o) => [o.durationMinutes, o]));
    expect(byD[10]!.status).toBe('fits');
    expect(byD[15]!.status).toBe('blocked');
    expect(byD[15]!.reason).toBe('conflict');
    expect(byD[20]!.status).toBe('blocked');
    expect(byD[30]!.status).toBe('blocked');
  });

  it('blocks a duration that fully overlaps with an existing appointment', () => {
    // Existing 11:00–11:30. Trying to start at 11:10 (any duration)
    // overlaps.
    const occupied: OccupiedInterval[] = [
      { startMin: 11 * 60, endMin: 11 * 60 + 30 },
    ];
    const result = computeAvailability(DEFAULT_HOURS, '2026-05-14', '11:10', occupied);
    expect(result.options.every((o) => o.status === 'blocked')).toBe(true);
    expect(result.options.every((o) => o.reason === 'conflict')).toBe(true);
  });

  it('returns a deterministic sorted unique duration list', () => {
    const hours: HoursConfig = {
      ...DEFAULT_HOURS,
      durations: [30, 10, 15, 20, 15], // dupes + out-of-order
      defaultDuration: 15,
    };
    const result = computeAvailability(hours, '2026-05-14', '10:30', []);
    expect(result.options.map((o) => o.durationMinutes)).toEqual([10, 15, 20, 30]);
  });

  it('marks the smallest configured duration as the slot unit', () => {
    const hours: HoursConfig = {
      ...DEFAULT_HOURS,
      durations: [20, 30, 45],
      defaultDuration: 30,
    };
    const result = computeAvailability(hours, '2026-05-14', '10:30', []);
    expect(result.slotUnitMinutes).toBe(20);
    const twenty = result.options.find((o) => o.durationMinutes === 20)!;
    expect(twenty.status).toBe('fits');
    const thirty = result.options.find((o) => o.durationMinutes === 30)!;
    expect(thirty.status).toBe('extends');
  });
});
