# ADR 011: Unified visit model (visits absorb appointments)

Date: 2026-05-14
Status: Accepted

## Context

Until this slice the data model had two adjacent tables:

- `appointments` — the receptionist's surface: `scheduled_for`, `duration_minutes`, `status` (`scheduled | completed | no_show | cancelled`).
- `visits` — the doctor's surface: clinical fields (`complaint`, `examinations`, `diagnoses`, `prescription`, payment code, etc.).

They were modelled separately because (a) an appointment can exist without a visit (no-show, cancelled) and (b) a clinical visit's payload is large. But at small clinics like DonetaMED, one patient session **is** one event. The two-table split forced two real problems:

1. The implicit linkage between an appointment and its clinical visit had no foreign key — it lived in `markCompletedFromVisit` (matching on `clinic_id + patient_id + scheduled_for::date`), and even that hook was never wired up.
2. Concepts that span the lifecycle (walk-ins, "patient has arrived", "this booking became this clinical record") had no clean home.

Phase 1 is the data-layer half of the merge. Phase 2a will rework the UI to consume the unified model natively; Phase 2b will add walk-in support.

## Decision

**Merge `appointments` into `visits` as one unified table.** The receptionist's booking and the doctor's clinical write-up are two views over the same row.

New columns on `visits`:

- `scheduled_for TIMESTAMPTZ NULL` — set when the receptionist books; null for walk-ins (Phase 2).
- `duration_minutes INT NULL` — set when the receptionist books.
- `is_walk_in BOOLEAN NOT NULL DEFAULT false` — Phase 2 sets `true` for walk-ins.
- `arrived_at TIMESTAMPTZ NULL` — when patient checks in (Phase 2 will populate).
- `status TEXT NOT NULL DEFAULT 'completed'` with `CHECK (status IN ('scheduled', 'arrived', 'in_progress', 'completed', 'no_show', 'cancelled'))`.

**`status` is TEXT + CHECK, not a Postgres enum.** Adding values to an enum requires `ALTER TYPE`, which doesn't compose with the rest of a migration; future additions (`rescheduled`, `partial_completion`, …) stay one-line ALTERs on the constraint.

Indexes:

- `(clinic_id, scheduled_for) WHERE scheduled_for IS NOT NULL` — partial, drives every calendar query. Rows that were never appointments (the doctor's "[Vizitë e re]" flow) stay out of the index.
- `(clinic_id, status)` — lifecycle-state filtering.

The `appointments` table is dropped outright; the `appointment_status` enum type is dropped with it. The dev DB has no production data to preserve, so the data migration is `make db-reset && make db-seed`; the seed populates a mix of completed and scheduled visits.

A thin **translation layer** in `apps/api/src/modules/appointments/appointments.service.ts` keeps the receptionist API endpoints (`/api/appointments`) working unchanged:

- Every read filters by `scheduled_for IS NOT NULL` (`APPT_BASE_WHERE`). A doctor-only clinical visit (no booking) is invisible to the appointments surface.
- Writes set `visit_date = scheduled_for::date`, `is_walk_in = false`, `status = 'scheduled'`, `updated_by = created_by`.
- `status` reads narrow the wider TEXT to the `AppointmentDto`'s four-value union via `narrowStatusForAppointment`; Phase-2 values (`arrived`, `in_progress`) collapse to `scheduled` so the existing UI keeps rendering them as upcoming work.
- Audit rows use `resource_type='visit'` (the row really lives there now); the `action` prefix stays `appointment.*` so receptionist-scheduling intent is preserved in the history.

`apps/api/src/modules/doctor-dashboard/doctor-dashboard.service.ts` splits the merged table back into the two views the dashboard already had:

- "Today's appointments" — `scheduled_for IS NOT NULL AND scheduled_for IN range`.
- "Today's visit log" — `visit_date IN range AND status='completed'`.

The patient chart (`apps/api/src/modules/patients/patient-chart.service.ts`) narrows its history list to `status IN ('completed', 'in_progress')` so receptionist-controlled lifecycle states stay out of the clinical timeline.

## Consequences

**Pros:**
- One row per patient session — the operational reality, finally reflected in the schema.
- No more implicit foreign keys between two tables; vërtetime, DICOM links, audit history already pointed at `visits`.
- Walk-ins (Phase 2) need no schema change — just `is_walk_in=true` + `scheduled_for=null`.
- `status` as TEXT + CHECK is one ALTER away from any future lifecycle addition.

**Cons:**
- Soft-deleting "the appointment" via the receptionist endpoint now soft-deletes the entire row. Pre-merge the two halves were independent. Acceptable: Phase 1 has no clinical data on rows that are still appointments, so the operational effect is identical.
- TEXT status is fractionally heavier than a Postgres enum (~5 bytes per row) and lacks compile-time exhaustiveness in raw SQL. The CHECK constraint plus the DTO-layer narrow keep the safety property.
- One translation layer to maintain until Phase 2a removes it.

**Accepted trade-offs:**
- The translation layer ships as production code; it's deliberately scoped to evaporate when the UI catches up.
- Phase-2 statuses are written by no caller in Phase 1, but the CHECK constraint allows them so the column doesn't need another migration when the lifecycle expands.

## Revisit when

- A clinic ever needs to legitimately have **two** rows for the same patient-session (multi-clinician handoff in one visit, etc.). Currently no.
- Performance of the partial scheduled-for index degrades on the platform's largest clinic (~10× DonetaMED's volume).
- A regulator requires separating appointment-state changes from clinical edits in the audit log — would split the `action` namespace, not the table.

## Implementation notes

- Migration: `apps/api/prisma/migrations/20260514170000_visits_absorb_appointments/migration.sql`.
- Translation layer: `apps/api/src/modules/appointments/appointments.service.ts` (will be removed in Phase 2a once the calendar UI queries `/api/visits?scheduled_for=…` natively).
- Receptionist privacy boundary (CLAUDE.md §1.2) unchanged — `AppointmentDto` only exposes `firstName`, `lastName`, `dateOfBirth`.
- Multi-tenant isolation (ADR-005) unchanged — RLS policy carried over from the appointments table to remain on `visits` (which already had it).
- Soft delete + 30s undo (ADR-008) unchanged in spirit; see "Known follow-ups" below for a latent bug surfaced during the merge.

## Known follow-ups (smoke test findings)

The Phase-1 smoke checklist surfaced four issues. Two are fixed in this slice; two are deferred to separate sessions because their fix isn't bounded by the merge.

### Finding 1 — Doctor dashboard "today's visit log" returns 0 rows (DEFERRED)

**Symptom**
The doctor's `/api/doctor/dashboard` returns `todayVisits=[]` and `stats.visitsCompleted=0` even when completed visits with `visit_date = today` exist.

**Root cause**
`visits.visit_date` is `@db.Date` (a DATE column). The dashboard's range comparison passes a `Date` instance derived from `localClockToUtc(today, '00:00')` — a `Timestamptz` instant at Belgrade-midnight, e.g. `2026-05-13T22:00:00Z`. Prisma serialises the operand to a DATE-only string when comparing against a `@db.Date` column, so the query Postgres receives is `visit_date >= '2026-05-13' AND visit_date < '2026-05-14'`. Rows with `visit_date = '2026-05-14'` (the doctor's local "today") fall outside.

**Why deferred**
Bug origin is commit `5d6e2b0 slice-10: doctor's home dashboard` — predates Phase 1. Latent before this slice because the seed didn't insert clinical visits with `visit_date = today`; the new seed exposes it. The fix likely affects more than the dashboard — any place that compares a `Date` JS value against a `@db.Date` column with a TIMESTAMPTZ-derived bound has the same drift.

**Shape of the fix**
Option A: switch `visit_date` to `@db.Timestamptz(6)` (one migration; ripples through every query). Option B: convert the range bounds to date strings (`from = 'YYYY-MM-DD'`, `to = next-day 'YYYY-MM-DD'`) at the boundary before passing to Prisma. Option B is smaller; Option A is more correct long-term. The session that picks one should also sweep for other DATE-vs-Timestamptz comparisons.

**Affected surfaces**
- `apps/api/src/modules/doctor-dashboard/doctor-dashboard.service.ts` (today's visit log query)
- Anywhere `visit_date: { gte, lt }` appears with a `Date` value — needs an audit
- `apps/api/src/modules/patients/patients.service.ts` (visit-count / last-visit math, worth re-checking)

**Origin**
Commit `5d6e2b0`, slice 10.

### Finding 2 — Patient chart returned scheduled appointments (FIXED IN THIS SLICE)

Chart history now narrows to `status IN ('completed', 'in_progress')`. Receptionist-controlled lifecycle states (`scheduled`, `arrived`, `no_show`, `cancelled`) stay out of the clinical timeline. Test added: `patients.integration.spec.ts → chart history excludes scheduled appointments`.

### Finding 3 — `POST /:resource/:id/restore` returns 404 across appointments/visits/patients (DEFERRED)

**Symptom**
After a soft delete + a `POST /api/appointments/:id/restore` (or `/api/visits/:id/restore`, or `/api/patients/:id/restore`), the server returns `404 "Termini nuk u gjet."` (or equivalent). The soft-deleted row still exists in the DB with `deleted_at` set; the restore lookup just can't see it.

**Root cause**
`apps/api/src/prisma/prisma.service.ts` registers a global soft-delete middleware that AND-injects `deletedAt: null` into every read on `Clinic`, `User`, `Patient`, `Visit`, and `Appointment`. The restore code paths explicitly pass `where: { id, clinicId, deletedAt: { not: null } }`. The middleware then composes the two as `AND([{ ..., deletedAt: { not: null } }, { deletedAt: null }])` — a conjunction that no row can satisfy.

**Why deferred**
Pre-existing since the middleware was added (well before Phase 1). The middleware affects three models (`visits`, `patients`, `appointments` — now just two) with the same broken pattern. The fix needs middleware-level care (a `skipSoftDelete` escape hatch, or model-level opt-out for restore code paths), not a per-call workaround, and should land with cross-resource regression tests.

**Shape of the fix**
Add a `params.args[__skipSoftDelete]` boolean (or a Prisma extension client) that the middleware respects; route every `restore()` through it. Add integration tests that round-trip a soft delete → restore → list for each resource.

**Affected surfaces**
- `apps/api/src/modules/appointments/appointments.service.ts → restore()`
- `apps/api/src/modules/visits/visits.service.ts → restore()`
- `apps/api/src/modules/patients/patients.service.ts → restore()`
- `apps/api/src/prisma/prisma.service.ts → softDeleteMiddleware`

**Origin**
Soft-delete middleware introduction (predates this slice; check `git blame` on `prisma.service.ts`).

### Finding 4 — Audit `resource_type='appointment'` after appointments table dropped (FIXED IN THIS SLICE)

All five `audit.record` calls in the appointments service translation layer now write `resource_type='visit'`. The `action` prefix stays `appointment.*` so a receptionist-side scheduling change still reads as such. Test added: `appointments.integration.spec.ts → appointment mutations write audit rows with resource_type=visit + action=appointment.*` (also asserts zero stray `resource_type='appointment'` rows after the round-trip).

### Out of scope — Puppeteer/Chrome on Apple Silicon

**Symptom**
`GET /api/print/visit/:id` returns 500; container log: `rosetta error: failed to open elf at /lib64/ld-linux-x86-64.so.2`.

**Root cause**
The default Puppeteer Chrome bundled in the API container is x86, running under Rosetta on Apple Silicon dev hosts. Not a code defect; an image/host-arch mismatch.

**Workaround**
- ARM-native Puppeteer image, OR
- Run PDF generation against a Linux x86 container, OR
- Skip print smoke tests on Apple Silicon and rely on CI.

Not blocking production (CI + production hosts are x86). Captured here so the next developer hitting it doesn't re-debug.
