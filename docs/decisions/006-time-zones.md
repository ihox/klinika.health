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
