// Working-hours helpers for the calendar surface.
//
// We treat a clinic day as either fully closed (UI shows "Mbyllur") or a
// single continuous open band defined by `start`/`end`. A configured
// "split shift" with a lunch gap is intentionally out of scope for v1
// per the design prototype's `closed-band removed: each open day is one
// continuous band per spec` annotation in receptionist.html.

import type { HoursConfig } from '../clinic-settings/clinic-settings.dto';
import { weekdayOf } from './visits-calendar.tz';

export interface OpenWindow {
  date: string; // ISO yyyy-mm-dd
  start: string; // HH:MM, inclusive
  end: string; // HH:MM, exclusive (the bookable end is `end - durationMinutes`)
}

/**
 * If the clinic is open on `dateIso`, return the configured open window;
 * otherwise null.
 */
export function openWindowForDay(
  hours: HoursConfig,
  dateIso: string,
): OpenWindow | null {
  const dow = weekdayOf(dateIso);
  const day = hours.days[dow];
  if (!day.open) return null;
  return { date: dateIso, start: day.start, end: day.end };
}

/**
 * Check whether `[startMin, endMin)` (minutes since 00:00 local) falls
 * entirely inside the clinic's open window for `dateIso`. Used both for
 * validation when creating/updating an appointment and for filtering
 * the calendar grid.
 */
export function fitsInsideHours(
  hours: HoursConfig,
  dateIso: string,
  startMin: number,
  durationMinutes: number,
): { fits: boolean; reason?: 'closed_day' | 'before_open' | 'after_close' } {
  const win = openWindowForDay(hours, dateIso);
  if (!win) return { fits: false, reason: 'closed_day' };
  const openMin = toMinutes(win.start);
  const closeMin = toMinutes(win.end);
  if (startMin < openMin) return { fits: false, reason: 'before_open' };
  if (startMin + durationMinutes > closeMin) return { fits: false, reason: 'after_close' };
  return { fits: true };
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
