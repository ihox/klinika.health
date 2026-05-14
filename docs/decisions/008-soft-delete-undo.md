# ADR 008: Soft delete with 30-second undo

Date: 2026-05-13
Status: Accepted

## Context

Doctors occasionally delete visits, vërtetime, or other clinical records — sometimes intentionally (wrong patient selected, test entry), sometimes by accident. We need:
- A friction-low delete flow (modal confirmation feels too heavy for routine cleanup)
- A safety net for accidental deletions
- Legal traceability (deletions must be recoverable for audit purposes)
- No data loss for at least the legal retention period (pediatric records ~21 years)

Options considered:
- **Hard delete with confirmation modal** — old-school, friction-heavy, no recovery
- **Hard delete without confirmation** — fast but dangerous
- **Soft delete with confirmation modal** — modal friction without the safety benefit
- **Soft delete with 30-second undo toast (Gmail pattern)** — fast + safe
- **Soft delete with no undo** — safe but requires admin intervention for "oops" cases

## Decision

**Soft delete with 30-second undo toast.** The Gmail pattern.

When a user clicks delete:
1. Record's `deleted_at` field set to current timestamp
2. UI hides the record immediately
3. A toast appears at the bottom: "Vizita u fshi. [Anulo]"
4. The toast persists for 30 seconds, with a countdown
5. Clicking "Anulo" sets `deleted_at` back to null, record reappears
6. After 30 seconds (no undo), toast dismisses
7. Record stays soft-deleted indefinitely (never hard-deleted in v1)

No confirmation modal. The undo is the safety net.

Every soft-delete writes an audit log row with `action: 'visit.deleted'` and the original record state captured in the snapshot.

Platform admin has a CLI tool (`pnpm cli purge:soft-deleted --older-than 5y`) to physically remove soft-deleted records older than a configurable threshold, if storage ever becomes a concern. Not used in v1.

## Consequences

**Pros:**
- Doctor's delete flow is fast (no modal interruption)
- Real "oops" recoveries are one click within 30 seconds
- Audit log captures the deletion attempt regardless
- Older deletions still recoverable via platform admin tools
- No data is ever truly lost in v1
- Matches the Gmail/Linear pattern users already know

**Cons:**
- Soft-deleted records accumulate in tables (acceptable: pediatric data should be retained anyway)
- Query layer must filter `deleted_at IS NULL` in every read (Prisma middleware handles this)
- If the user's connection drops within 30 seconds, undo isn't possible (rare, manual recovery via support)
- Slightly more storage usage over time (negligible at clinic scale)

**Accepted trade-offs:**
- All queries filter `deleted_at IS NULL` by default (one Prisma middleware enforces this)
- "Show deleted" is a platform-admin-only feature
- We don't yet have a UI for restoring deletions older than 30 seconds — support operation only

## Revisit when

- Storage usage from soft-deleted records becomes significant (>10% of table size)
- Users frequently need to restore deletions older than 30 seconds (might add a "Recently deleted" view per clinic admin)
- Legal retention rules require explicit hard-delete after N years (would add automated purge)

## Implementation notes

- Every clinical table has a `deleted_at TIMESTAMPTZ NULL` column
- Default Prisma middleware adds `WHERE deleted_at IS NULL` to all reads
- Explicit `includeDeleted: true` flag bypasses for admin queries
- Toast component shows live countdown
- Undo button calls the same endpoint with `restore: true`
- 30-second timer is client-side; the actual deleted_at stays set
- If user logs out within 30 seconds, the toast disappears but the record stays soft-deleted (recoverable by support)
- Audit log on delete:
  ```json
  {
    "action": "visit.deleted",
    "resourceId": "<visit-id>",
    "changes": null,
    "metadata": { "snapshotAtDelete": { ... } }
  }
  ```

## Middleware fix (2026-05-14)

**Bug.** The soft-delete Prisma middleware in `apps/api/src/prisma/prisma.service.ts` AND-ed `deletedAt: null` into the WHERE clause of every read on a soft-delete-tracked model. The three restore code paths (`appointments.service.ts`, `visits.service.ts`, `patients.service.ts`) pass `deletedAt: { not: null }` in the WHERE to find the soft-deleted row before un-deleting it. The middleware's AND-wrap turned that into `AND [{ deletedAt: { not: null } }, { deletedAt: null }]` — an unsatisfiable conjunction — so every restore returned 404. The `findUnique` branch had the same latent bug via spread-overwrite, though no caller hit that path today. Bug latent since the middleware was added; integration tests don't run in CI, so it surfaced only during the Phase 1 visits-merge smoke test (Finding #3).

**Fix.** The middleware now inspects the caller's WHERE for a top-level `deletedAt` key and, if present, skips its default injection entirely. The caller's intent wins. Same logic applies to both the `findFirst`/`findMany`/`count`/`aggregate`/`groupBy` AND-wrap path and the `findUnique`/`findUniqueOrThrow` spread path. On bypass, the middleware emits a Pino warning (`soft-delete filter bypassed via explicit deletedAt in where clause`) so accidental bypasses stay visible in operational logs.

**Limitations.** Only top-level `deletedAt` is detected. Filters nested inside an explicit `AND`/`OR`/`NOT` are not auto-bypassed — callers needing such a shape must lift `deletedAt` to the top level. Documented inline in the middleware.

**Tests added** to prevent regression:
- `apps/api/src/prisma/prisma.service.spec.ts` — four new unit tests covering both bypass paths (`findFirst` + `findUnique`), the warning emission, and a sanity check that the default injection still happens when no `deletedAt` is in the caller's WHERE.
- `apps/api/src/prisma/prisma.integration.spec.ts` — live-DB restore round-trip: soft-delete → explicit-`deletedAt` lookup finds the row → un-delete → default fetch reloads it.
- `apps/api/src/modules/{appointments,visits,patients}/*.integration.spec.ts` — each gains a "restore on a never-deleted row returns 404" case so the only remaining failure mode is exercised end-to-end.
