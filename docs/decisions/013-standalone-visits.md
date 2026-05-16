# ADR 013: Standalone clinical visits

Date: 2026-05-16
Status: Accepted

## Context

After ADR-011 merged `appointments` into `visits`, the unified table holds rows that come from three operational paths:

1. **Scheduled booking** — the receptionist creates the row via `POST /api/visits/scheduled`. `scheduled_for` carries the slot, `is_walk_in=false`, `status='scheduled'`. The receptionist later transitions it through the lifecycle.
2. **Paired walk-in** — created via `POST /api/visits/walkin` (receptionist) or via the walk-in branch of `POST /api/visits/doctor-new` (doctor's "+ Vizitë e re" for a sibling/companion). `scheduled_for=null`, `is_walk_in=true`, `paired_with_visit_id` points to the booking the walk-in shares a calendar row with.
3. **Standalone clinical visit** — `scheduled_for=null`, `is_walk_in=false`, `paired_with_visit_id=null`. Created by the doctor when there is no booking to pair against (no schedule on the day, or every booking already has a paired walk-in) or by the legacy `POST /api/visits` (still mounted, deprecation tracked separately).

Until now this third shape had no name. The doctor's `doctor-new` endpoint falls through to it as a quiet "neither of the structured paths fit, just make a chart entry" branch, and the legacy POST emits one unconditionally. The receptionist's calendar — `CALENDAR_VISIBLE_WHERE = (scheduled_for IS NOT NULL OR is_walk_in=true)` — never surfaces them, which is correct for the calendar grid but causes:

- **Stats divergence.** The receptionist's `/api/visits/calendar/stats` filtered through the same predicate excludes standalone money, while the doctor's home `/api/doctor/dashboard` queries `status='completed' AND visit_date=today` and includes it. Same clinic, same day, two different totals (fixed in this PR).
- **Audit-log opacity.** Both creation paths emit the same `visit.created` action, so retrospective "how many standalones did Dr. Taulant create this week?" needs row reconstruction (fixed in this PR via the new `visit.standalone.created` action).
- **No reference.** A team member or future Claude session reading the code has to reconstruct the three shapes from `is_walk_in`/`scheduled_for`/`paired_with_visit_id` combinations.

## Decision

**Name the third shape "standalone" and pin its definition in code, docs, and an audit-log action.**

### Shape definition

A row is a **standalone clinical visit** iff:

- `scheduled_for IS NULL`, AND
- `is_walk_in = false`, AND
- `paired_with_visit_id IS NULL` (implied by the `is_walk_in=false` half via the CHECK constraint that limits pairing to walk-ins).

A pure classifier `classifyVisitShape({ scheduled_for, is_walk_in })` returns one of `'scheduled' | 'walk_in' | 'standalone'` and lives at `apps/api/src/modules/visits/visit-shape.ts`. This is the single chokepoint readers use to ask "which shape is this row?".

### Legitimate use cases

A standalone visit is legitimate when:

- **Off-schedule encounter.** Doctor opens a chart for a patient who is not on today's calendar (phone consult that needs documenting, a quick post-discharge follow-up, a chart correction after the fact).
- **Sibling visit when no unpaired slot exists.** The receptionist may not have time to register a walk-in pairing target; the doctor charts the sibling, the row falls back to standalone.
- **Legacy clinical writeup** (transitional, will fold away when the legacy `POST /api/visits` is removed in a later slice).

### Audit-log differentiation

Three creation paths now emit three distinct audit-log actions:

| Path | Action |
|---|---|
| Receptionist booking | `visit.scheduled` |
| Paired walk-in (receptionist or doctor) | `visit.walkin.added` |
| Standalone clinical visit | `visit.standalone.created` |

The new action is added to the visit history filter so the chart's change-history modal still shows the "created" event on standalone visits. Historical rows tagged with the old `visit.created` action keep that label — the audit log is append-only — and the history filter retains `visit.created` in its `IN` list to surface them.

### Scope boundary

Standalone visits remain invisible to the calendar feed and to per-row receptionist UI in this PR. Receptionist visibility (a separate "Vizita pa termin sot" panel, SSE emission on the standalone creation path, optional unpaired walk-ins) is a separate, follow-up slice.

### Scenarios captured

| # | Patient already has on the day | Doctor clicks "+ Vizitë e re" → | Result |
|---|---|---|---|
| A | nothing on calendar; no schedule today | (no patient row today) | standalone (the fallback this ADR documents) |
| B | nothing on calendar; some other patient has a scheduled booking | (the new visit is paired) | walk_in paired to that booking |
| C | the SAME patient has an active visit today (scheduled / arrived / in_progress) | (no new row should be created) | **return the existing visit's id** (Slice B of this PR) |
| D | the SAME patient completed a visit earlier today | (legitimate follow-up) | standalone (or walk-in if a paired slot is available) |
| E | every scheduled booking on the day is already paired | (no slot left to pair) | standalone (the fallback this ADR documents) |

## Consequences

**Pros:**
- The third shape is named and documented; future code, reviews, and incident analysis can reference "standalone" without ambiguity.
- Audit-log differentiation enables retrospective queries on standalone volume per doctor / per week.
- Receptionist stats can now include standalone money safely (fixed in Slice F of this PR) — the policy doc establishes that standalones ARE clinical revenue, the receptionist just doesn't see the row.
- The classifier is the single chokepoint — adding a fourth shape later is a one-function change.

**Cons:**
- One more audit-log action to remember when grepping. The `visit.*.created` family is now three values instead of two.
- The classifier introduces a slim helper module; readers must know to grep for `classifyVisitShape` rather than reading `is_walk_in` directly. Acceptable — the alternative is open-coding the three-way check at every reader.

**Accepted trade-offs:**
- We do NOT add a `creation_type` column on `visits`. The derivation from `(scheduled_for, is_walk_in)` is total and stable; a stored column would denormalize without buying observability the audit-log action doesn't already give us.
- Pre-PR standalone rows keep the `visit.created` action in their audit history. The history filter accepts both actions to surface them.

## Revisit when

- A fourth row shape emerges (e.g. AI-generated draft visits, multi-clinician handoff rows). The classifier accepts the addition; the policy doc needs an entry.
- Standalone visit volume becomes operationally significant on a clinic — the audit-log action lets us count, and that count will drive whether the receptionist panel ships.
- The legacy `POST /api/visits` is fully removed; the line "or by the legacy POST /api/visits" can come out of the use-case list.

## Implementation notes

- Helper: `apps/api/src/modules/visits/visit-shape.ts`, with unit tests in `visit-shape.spec.ts`.
- Audit-log action: `visit.standalone.created` emitted by `VisitsService.create()`. The legacy POST `/api/visits` and the standalone-fallback branch of `POST /api/visits/doctor-new` both flow through this method.
- History filter: `VisitsService.getHistory()` at `visits.service.ts` accepts both `visit.created` (pre-PR) and `visit.standalone.created` (post-PR) so the chart's change-history modal keeps surfacing the creation event.
- Receptionist stats: `VisitsCalendarService.statsForDay()` rebased on `visit_date = <day>` (matches the doctor's dashboard query) so completed standalones contribute to the day total. A `standaloneCount` field is added to `CalendarStatsResponse` for future UI work — the per-row "Vizita pa termin sot" panel is deferred.
