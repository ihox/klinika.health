# ADR 006: Time zones (Europe/Belgrade everywhere)

Date: 2026-05-13
Status: Accepted

## Context

Klinika operates in Kosovo and the broader Balkans. All clinics are in the `Europe/Belgrade` time zone (equivalent to `Europe/Pristina`). Timestamps appear in:
- The doctor's UI (visit times, appointment times, audit log)
- Printed documents (visit reports, vërtetime)
- Database records (`created_at`, `updated_at`)
- Operational logs
- Backup filenames
- Telemetry data

We need a consistent time zone strategy that prevents subtle bugs (e.g. an appointment booked at 09:00 displaying as 08:00 due to DST mishandling, or a "today's visits" query missing visits because of UTC offset).

## Decision

Single time zone throughout the system: **Europe/Belgrade**.

- All database timestamps stored as `TIMESTAMPTZ` in UTC (Postgres convention)
- All UI display in `Europe/Belgrade`
- All Docker containers run with `TZ=Europe/Belgrade` environment variable
- The host OS on staging, production, and on-premise installs runs `Europe/Belgrade` system time
- All log timestamps display in `Europe/Belgrade`
- All print templates render dates in `Europe/Belgrade`
- All date/time math uses `date-fns` + `date-fns-tz` explicitly — never the host default
- Test fixtures use explicit `Europe/Belgrade` timestamps

For dates that don't carry time information (birth date, vërtetim absence range), we store as `DATE` (no time component) and treat as `Europe/Belgrade`-local dates.

## Consequences

**Pros:**
- Eliminates an entire class of "off by one hour during DST" bugs
- Doctor never sees confusing UTC times
- Printed documents always show the local date the visit happened
- "Today's visits" queries return the doctor's intuitive set of visits
- Same code path works for cloud and on-premise (both run in `Europe/Belgrade`)

**Cons:**
- Multi-region future would require revisiting (e.g. a clinic in Western Europe with different DST timing)
- Daylight Saving Time transitions in March/October require careful test coverage (one 23-hour day and one 25-hour day per year)
- Server logs aren't in UTC, so cross-system correlation requires conversion (acceptable since we don't aggregate logs cross-region)

**Accepted trade-offs:**
- We commit to a single time zone for v1 and the foreseeable future
- DST edge cases tested explicitly in date utility tests
- If we ever expand to clinics outside `Europe/Belgrade`, this becomes a per-clinic config and requires data migration

## Revisit when

- We onboard a clinic in a different time zone
- We add features that span time zones (cross-clinic referrals, etc.)
- A regulator requires UTC-only timestamps in audit logs

## Implementation notes

- `apps/api/src/common/datetime.ts` — wrappers around date-fns-tz with `Europe/Belgrade` baked in
- Prisma client returns `Date` objects in UTC; UI code converts to `Europe/Belgrade` via `date-fns-tz`
- Background jobs that run "at 9am" use the user's clinic's time zone (which is always `Europe/Belgrade` today, but designed to be looked up from clinic settings)
- Tests for date utilities include DST transition cases:
  - 31 March 2024 (DST start: skip 02:00–03:00)
  - 27 October 2024 (DST end: 03:00 happens twice)
  - 30 March 2025, 26 October 2025 (similar)
  - 29 March 2026, 25 October 2026
- DateTime serialization in API: always ISO 8601 with explicit offset (`2026-05-13T14:23:45+02:00`)

## DATE vs Timestamptz operand fix (2026-05-14)

**The bug.** `visits.visit_date` is `@db.Date` (date-only, no time). The doctor's home dashboard computed `dayStartUtc = localClockToUtc(today, '00:00')` and used it as a Prisma `where: { visitDate: { gte: dayStartUtc, lt: dayEndUtc } }` operand. Prisma serializes a `Date` bound to an `@db.Date` column by `toISOString().slice(0, 10)`, i.e. the **UTC** date portion. In summer (CEST, UTC+2), `localClockToUtc('2026-05-14', '00:00')` is `2026-05-13T22:00:00Z`, which serializes as `'2026-05-13'`. The range became `WHERE visit_date >= '2026-05-13' AND visit_date < '2026-05-14'`, silently excluding rows with today's actual local date. The bug had been latent since Slice 10 because earlier seeds did not populate clinical visit rows; Phase 1's new seed populated `visit_date = today`, surfacing it via the dashboard's "today's completed visits" panel.

**The fix.** New utilities in `apps/api/src/common/datetime.ts`:

- `localDateToday(tz = 'Europe/Belgrade'): string` — today as `YYYY-MM-DD` in the local zone.
- `localDateRange(from, to, tz = 'Europe/Belgrade'): { from, to }` — inclusive YYYY-MM-DD bounds.
- `localMonthStart(tz = 'Europe/Belgrade'): string` — first of the current local month as `YYYY-MM-01`.
- `utcMidnight(iso): Date` — converts a `YYYY-MM-DD` to a UTC-midnight `Date`. Prisma's runtime parser rejects bare date strings ("Expected ISO-8601 DateTime"), so DATE-column where-clauses need a Date whose UTC date portion equals the desired local date. The canonical call pattern is `visitDate: utcMidnight(localDateToday())`.

**Surfaces audited and fixed.**

| File | Before | After |
| --- | --- | --- |
| `apps/api/src/modules/doctor-dashboard/doctor-dashboard.service.ts` | `visitDate: { gte: localClockToUtc(today, '00:00'), lt: … }` (Timestamptz range) | `visitDate: utcMidnight(today)` (single DATE equality) |
| `apps/api/src/modules/admin/admin-health.service.ts` | `visitDate: { gte: new Date(year, month, 1) }` (host-local Timestamptz) | `visitDate: { gte: utcMidnight(localMonthStart()) }` |
| `apps/api/src/modules/doctor-dashboard/doctor-dashboard.integration.spec.ts` (test seed) | `visitDate: localClockToUtc(today, '00:00')` (silently stored yesterday's date) | `visitDate: new Date(\`${today}T00:00:00Z\`)` (matches production at `visits.service.ts:79`) |

Other surfaces in the audit — print.service.ts (compares one visit's `visit_date` against another's, both round-tripped via Prisma; date portion preserved), appointments.service.ts (`markCompletedFromVisit` operates on `scheduledFor`, a Timestamptz column, so the Timestamptz operand is correct), `_max: { visitDate }` aggregations (read-only) — were verified correct and left untouched.

**Test coverage added.**

- `apps/api/src/common/datetime.spec.ts` — 15 unit tests covering `localDateToday`, `localDateRange`, `localMonthStart`, `localDateOf`, and `utcMidnight`. DST boundary cases: 23:59 Belgrade on the eve of spring-forward and fall-back, 00:01 Belgrade just after each transition, and the "host UTC clock late evening" case (23:00 UTC on 2026-05-14 = 01:00 Belgrade on 2026-05-15). `localMonthStart` includes the "last-day-of-month UTC evening rolls forward to new month" case that mirrors the original admin-health bug class.
- `apps/api/src/modules/doctor-dashboard/doctor-dashboard.integration.spec.ts` — adds a dedicated regression test ("today's visit appears in todayVisits regardless of UTC offset"). All pre-existing dashboard integration tests were updated to seed via `visitDateFor(today)` (UTC-midnight pattern matching production).
