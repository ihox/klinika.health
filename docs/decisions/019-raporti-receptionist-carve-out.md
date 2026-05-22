# ADR 019: Raporti receptionist carve-out — aggregate operational data is not chart PHI

Date: 2026-05-22
Status: Accepted

## Context

CLAUDE.md §1.2 (non-negotiable #2) reads, verbatim:

> Receptionist sees only patient name and DOB. No address, phone, clinical
> data, payment codes, allergies, or any other field. Enforced at three
> layers: UI, API, and Postgres Row-Level Security.

The rule has been load-bearing across the visits module: `VisitsController`
is `@Roles('doctor', 'clinic_admin')` only, and `VisitsCalendarService.toDto`
strips `paymentCode` from the response when `isReceptionistOnly(ctx.roles)`.
The receptionist's calendar shows only first name, last name, DOB, and a
status chip — no codes, no €, no clinical notes.

The new **Raporti i ditës** page — the daily revenue + visit report — sits
deliberately outside that boundary. The page surfaces:

- Aggregate revenue for the day (one big number)
- Aggregate visit count + status breakdown (completed/no-show/scheduled)
- A per-visit table including patient name, DOB, status chip, **payment
  code (A/B/C/D/E)**, **payment amount (€)**, and a "Vizita e parë" note

The receptionist needs Raporti for the operational reconciliation task
they already perform at the end of each day: matching the cash they
collected against the codes they entered at check-in. The page is the
canonical replacement for the running revenue totals removed from the
doctor + receptionist home pages in commit `02911ea` (Dr. Taulant
explicitly asked for those to disappear from the home surfaces).

Three options were considered:

1. **Full ticket view** — receptionist sees the same Raporti as the
   doctor / clinic_admin, but with a server-enforced date restriction
   (today + yesterday only).
2. **Aggregate tiles only** — receptionist sees the three header tiles
   but not the per-visit table.
3. **No receptionist access** — Raporti is doctor + clinic_admin only;
   the receptionist's nav link is hidden.

(2) and (3) both leave the receptionist without the tool they need to do
their primary end-of-day task. (2) in particular gives them a total but
not the per-row breakdown they reconcile against the cash drawer; (3)
would force the receptionist to ask the doctor for a print every evening,
which defeats the entire purpose of the daily report.

The deciding observation is that **the receptionist enters the payment
code at check-in**. Showing the receptionist a daily aggregate of codes
they personally entered is not a PHI disclosure — it's a read-back of
their own operational input.

## Decision

CLAUDE.md §1.2 governs the **patient chart surface** — anywhere a single
patient's identity is the subject and clinical data is the verb. It does
NOT govern aggregate end-of-day reporting where the patient is one row
among many and the report is the verb. Raporti is the named carve-out.

Concretely:

- `/raporti` (GET) is accessible to `doctor`, `receptionist`, and
  `clinic_admin`. Platform admins are blocked (apex domain, no clinic
  context).
- The endpoint is `GET /api/visits/daily-summary?date=YYYY-MM-DD`. The
  response is identical for all three roles — same fields, same
  per-visit payment codes, same amounts.
- **Server-side date restriction (receptionist only):** if the caller
  has `receptionist` AND lacks both `doctor` and `clinic_admin`
  (i.e. `isReceptionistOnly(ctx.roles) === true`), the endpoint accepts
  only `date ∈ { today, today - 1 }` in `Europe/Belgrade`. Any other
  date (older OR future) returns `403 Forbidden` with
  `{ reason: 'date_out_of_range', message: 'Nuk keni qasje për këtë datë.' }`.
- Doctor and clinic_admin have no date restriction (forward and back).
- Every successful daily-summary read writes an audit row with
  `action: 'report.daily.read'`, `resourceType: 'report'`,
  `resourceId: <YYYY-MM-DD>`, `changes: null`. Sensitive-read pattern
  per CLAUDE.md §5.3.
- The existing chart, visit-CRUD, and patient-detail surfaces remain
  under the §1.2 boundary unchanged. No `paymentCode` leaks through
  `VisitsCalendarService.toDto`; the calendar feed still redacts.

The carve-out is **named and scoped**: only the Raporti endpoint, only
aggregate-over-day data, only with the date guard. Any future
operational surface that wants to surface per-row payment data to a
receptionist must reference this ADR explicitly.

## Consequences

**Pros**
- Receptionist can do their end-of-day reconciliation without escalating
  to the doctor.
- Single source of truth replaces the home-page revenue tiles Dr.
  Taulant asked to remove.
- The carve-out is structural, not ad-hoc: a single predicate
  (`isReceptionistOnly` + endpoint-name allowlist) gates the exception.

**Cons / accepted**
- §1.2 is no longer literally "receptionist sees only name and DOB"
  everywhere — the rule needs to be read together with this ADR.
  CLAUDE.md §1.2 is updated in the same commit to point at this ADR
  by name.
- A receptionist with stolen credentials can now read 2 days of
  payment-code data, not 0. The blast radius is bounded by the date
  guard; the existing session controls (MFA, trusted device, rate limit)
  remain the primary defense.
- Future ad-hoc requests to widen the carve-out (weekly view, monthly
  view) must reopen this decision. The default answer is no.

## Revisit when

- A second operational-aggregate surface is proposed (weekly revenue,
  per-doctor monthly). Either rewrite §1.2 + this ADR, or open a new
  ADR for the second carve-out.
- The receptionist role is split (e.g. "front desk" vs "billing clerk").
  This ADR assumes one receptionist role with both roles' duties.
- The platform onboards a clinic where Kosovo's accounting law requires
  a longer retroactive window than 2 days (today + yesterday). The date
  guard is a parameter, not a constant — adjust without reopening.
