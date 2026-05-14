// Time-of-day greeting selection.
//
// The doctor's home screen opens with one of four Albanian greetings:
//
//   05:00–11:59 → Mirëmëngjes   ("Good morning")
//   12:00–17:59 → Mirëdita      ("Good afternoon")
//   18:00–22:59 → Mirëmbrëma    ("Good evening")
//   23:00–04:59 → Natë e mbarë  ("Good night")
//
// Boundaries chosen so they match how a Kosovo speaker would feel
// each part of the day, not strict astronomical windows.
//
// The selection is timezone-anchored to Europe/Belgrade per ADR-006 so
// it doesn't drift with the user's browser locale, the server's OS
// timezone, or DST. We expose a pure function so the unit test
// (doctor-dashboard.greeting.spec.ts) can pin a specific instant
// without timezone fakery.

export type DoctorGreeting =
  | 'Mirëmëngjes'
  | 'Mirëdita'
  | 'Mirëmbrëma'
  | 'Natë e mbarë';

const BELGRADE_TZ = 'Europe/Belgrade';

/** Pick a greeting for the given instant, rendered in Europe/Belgrade. */
export function greetingForInstant(
  instant: Date,
  tz: string = BELGRADE_TZ,
): DoctorGreeting {
  const hour = belgradeHour(instant, tz);
  return greetingForHour(hour);
}

/** Pure-numeric variant — exposed for property-style tests. */
export function greetingForHour(hour: number): DoctorGreeting {
  if (hour >= 5 && hour < 12) return 'Mirëmëngjes';
  if (hour >= 12 && hour < 18) return 'Mirëdita';
  if (hour >= 18 && hour < 23) return 'Mirëmbrëma';
  return 'Natë e mbarë';
}

function belgradeHour(instant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const part = fmt.formatToParts(instant).find((p) => p.type === 'hour');
  const value = part ? Number(part.value) : NaN;
  if (Number.isNaN(value)) return 0;
  return value;
}
