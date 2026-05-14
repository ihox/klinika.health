// Pure conflict-detection helper for the booking dialog's availability
// view. Extracted from AppointmentsService so it can be unit-tested
// without spinning up Prisma — the live service composes this with a
// single round-trip to fetch the day's appointments.
//
// Three statuses match the design prototype:
//   - `fits`    — clean fit, no warnings
//   - `extends` — fits without overlap but the booking spills past the
//                 natural slot unit (smallest configured duration);
//                 UI shows a calm "Të vazhdojmë?" notice
//   - `blocked` — out-of-hours OR overlaps with an existing appointment

import type { HoursConfig } from '../clinic-settings/clinic-settings.dto';
import type {
  AvailabilityOption,
  AvailabilityReason,
  AvailabilityStatus,
} from './appointments.dto';
import { fitsInsideHours, minutesToTime, toMinutes } from './appointments.hours';

export interface OccupiedInterval {
  /** Local start minutes since midnight (Europe/Belgrade). */
  startMin: number;
  /** Local end minutes since midnight (exclusive). */
  endMin: number;
}

export interface AvailabilityResult {
  slotUnitMinutes: number;
  options: AvailabilityOption[];
}

/**
 * Compute the per-duration verdicts for an anchor (date, time) given
 * the clinic's hours and the existing same-day intervals.
 *
 * `occupied` MUST already exclude the appointment being edited so the
 * receptionist can re-save without self-conflicting.
 */
export function computeAvailability(
  hours: HoursConfig,
  dateIso: string,
  time: string,
  occupied: OccupiedInterval[],
): AvailabilityResult {
  const startMin = toMinutes(time);
  const sortedDurations = Array.from(new Set(hours.durations)).sort((a, b) => a - b);
  const slotUnitMinutes = sortedDurations[0] ?? hours.defaultDuration;

  const options = sortedDurations.map<AvailabilityOption>((duration) => {
    const fit = fitsInsideHours(hours, dateIso, startMin, duration);
    if (!fit.fits) {
      return {
        durationMinutes: duration,
        status: 'blocked',
        endsAt: null,
        reason: (fit.reason ?? null) as AvailabilityReason | null,
      };
    }
    const endMin = startMin + duration;
    const overlap = occupied.some(
      (iv) => iv.startMin < endMin && iv.endMin > startMin,
    );
    if (overlap) {
      return {
        durationMinutes: duration,
        status: 'blocked',
        endsAt: null,
        reason: 'conflict',
      };
    }
    const status: AvailabilityStatus =
      duration > slotUnitMinutes ? 'extends' : 'fits';
    return {
      durationMinutes: duration,
      status,
      endsAt: minutesToTime(endMin),
      reason: null,
    };
  });

  return { slotUnitMinutes, options };
}
