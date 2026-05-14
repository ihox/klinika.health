// Tiny timezone helpers for Europe/Belgrade local-clock ↔ UTC mapping.
//
// We don't pull date-fns into the API for one feature; the platform's
// `Intl.DateTimeFormat` is enough as long as we round-trip carefully.
// Pure functions, no module state, safe for unit testing.

const DEFAULT_TZ = 'Europe/Belgrade';

/**
 * Convert a local clock value (date `YYYY-MM-DD`, time `HH:MM`) in the
 * given IANA zone into a UTC `Date`. Correctly handles DST transitions
 * because the offset is recomputed at the resulting instant.
 */
export function localClockToUtc(
  dateIso: string,
  time: string,
  tz: string = DEFAULT_TZ,
): Date {
  const [y, m, d] = dateIso.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (
    y == null ||
    m == null ||
    d == null ||
    hh == null ||
    mm == null ||
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d) ||
    Number.isNaN(hh) ||
    Number.isNaN(mm)
  ) {
    throw new Error('Invalid local clock value');
  }
  const naiveAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  // What clock would `naiveAsUtc` show in the target zone? The diff
  // between that and `naiveAsUtc` is exactly the zone offset at that
  // instant. Subtract to recover the UTC instant whose local clock is
  // the requested one.
  const tzClock = getZoneClock(naiveAsUtc, tz);
  const offsetMs = tzClock - naiveAsUtc;
  return new Date(naiveAsUtc - offsetMs);
}

/**
 * Format a UTC instant as `{ date: 'YYYY-MM-DD', time: 'HH:MM' }` in the
 * target zone. Useful for grouping appointments by their local day.
 */
export function utcToLocalParts(
  instant: Date,
  tz: string = DEFAULT_TZ,
): { date: string; time: string; weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'> = {
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
    Sun: 'sun',
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: weekdayMap[parts.weekday ?? ''] ?? 'mon',
  };
}

function getZoneClock(instant: number, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(instant)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
}

/** Iterate the inclusive ISO date range yielding `YYYY-MM-DD` strings. */
export function* iterateLocalDays(fromIso: string, toIso: string): Generator<string> {
  const [yf, mf, df] = fromIso.split('-').map(Number) as [number, number, number];
  const [yt, mt, dt] = toIso.split('-').map(Number) as [number, number, number];
  let cur = Date.UTC(yf, mf - 1, df);
  const end = Date.UTC(yt, mt - 1, dt);
  while (cur <= end) {
    const d = new Date(cur);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    yield `${y}-${m}-${day}`;
    cur += 86_400_000;
  }
}

/** Day-of-week key for an ISO date (using UTC arithmetic — safe because we just want the weekday). */
export function weekdayOf(dateIso: string): 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  return order[dt.getUTCDay()] ?? 'mon';
}
