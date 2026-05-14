// Date utilities for DATE-typed Postgres columns (e.g. visits.visit_date).
//
// Prisma serializes Date values bound to a `@db.Date` column by taking
// the *UTC* date portion of the Date (`toISOString().slice(0, 10)`). A
// Timestamptz value derived from a Belgrade-local clock (e.g.
// `localClockToUtc(today, '00:00')` → `2026-05-13T22:00:00Z` in summer)
// therefore serializes as the previous day. That mismatch was the
// root cause of the dashboard "today's visits" bug fixed in ADR-006.
//
// Rule of thumb:
//   - `Timestamptz` column → bind a `Date` (see appointments.tz.ts)
//   - `Date`         column → bind a `YYYY-MM-DD` string (these helpers)
//
// All helpers default to `Europe/Belgrade`, per CLAUDE.md §5.6, but
// accept any IANA zone so platform-admin tooling can pass through a
// future per-clinic timezone setting without code changes.

const DEFAULT_TZ = 'Europe/Belgrade';

/**
 * Today's date in `YYYY-MM-DD` as observed in `tz`. Use as the operand
 * for `@db.Date` column comparisons such as
 * `where: { visitDate: localDateToday() }`.
 */
export function localDateToday(tz: string = DEFAULT_TZ): string {
  return localDateOf(new Date(), tz);
}

/**
 * First day of the current month in `tz`, formatted `YYYY-MM-01`.
 * For DATE-column "this month" queries.
 */
export function localMonthStart(tz: string = DEFAULT_TZ): string {
  const today = localDateOf(new Date(), tz);
  return `${today.slice(0, 7)}-01`;
}

/**
 * Inclusive `YYYY-MM-DD` bounds for a DATE-column range query.
 *
 * Each input may be:
 *   - a `YYYY-MM-DD` string, which is returned verbatim, or
 *   - a `Date`, which is reduced to its local date in `tz`.
 *
 * Use as
 * `where: { visitDate: { gte: from, lte: to } }` — note that the
 * upper bound is **inclusive** because both operands are dates with no
 * time component, and `lt: 'YYYY-MM-DD'` would silently drop the last
 * day of the range.
 */
export function localDateRange(
  from: Date | string,
  to: Date | string,
  tz: string = DEFAULT_TZ,
): { from: string; to: string } {
  return {
    from: typeof from === 'string' ? from : localDateOf(from, tz),
    to: typeof to === 'string' ? to : localDateOf(to, tz),
  };
}

/**
 * Convert a `YYYY-MM-DD` string into a UTC-midnight `Date`. Prisma's
 * runtime parser rejects bare date strings ("Expected ISO-8601
 * DateTime"), so DATE-column where-clauses need a Date instance whose
 * UTC date portion is the desired local date. This is the canonical
 * conversion used by every call site that compares against
 * `@db.Date` columns.
 *
 *   prisma.visit.findMany({
 *     where: { visitDate: utcMidnight(localDateToday()) },
 *   });
 *
 * The Date returned is *not* "midnight Belgrade" — it's midnight UTC,
 * intentionally. Prisma serializes Date → DATE by `toISOString().slice(0,10)`,
 * so this is the only construction whose round-trip preserves the
 * local date verbatim.
 */
export function utcMidnight(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/**
 * Reduce an instant to its `YYYY-MM-DD` representation in `tz`.
 * Exported for tests that need a deterministic anchor; production
 * callers should prefer the dedicated helpers above.
 */
export function localDateOf(instant: Date, tz: string = DEFAULT_TZ): string {
  // `sv-SE` formats numerics as `YYYY-MM-DD HH:MM:SS` so the date
  // portion is a direct substring — no locale juggling or month-name
  // parsing. `Intl.DateTimeFormat` is offset-aware, so DST transitions
  // are handled implicitly (the platform's tz database is canonical).
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(instant).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
