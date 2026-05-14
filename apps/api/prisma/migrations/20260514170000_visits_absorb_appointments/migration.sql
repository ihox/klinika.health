-- Phase 1 of the visits merge — absorb `appointments` into `visits`.
--
-- At small clinics like DonetaMED, "appointment" and "visit" are the
-- same conceptual thing — one patient session, one event. Keeping them
-- in two tables created an artificial seam with no payoff. This
-- migration collapses the two into a single unified `visits` table.
--
-- See ADR-011 (Unified visit model) for the rationale and lifecycle.
--
-- Phase 1 has no production data to preserve — the dev DB carries only
-- seed and throwaway smoke-test rows — so the migration drops the
-- `appointments` table outright. The seed is rewritten in the same PR
-- to populate the new unified columns; the translation layer in the
-- appointments service repoints reads/writes at `visits`. API and UI
-- contracts are unchanged.

-- ---------------------------------------------------------------------------
-- 1. New columns on `visits`.
--
--    Status is TEXT + CHECK (not a Postgres enum) so future additions
--    (`rescheduled`, `partial_completion`, …) don't require an
--    enum-alter migration dance. The default `completed` lines up with
--    legacy visit rows: every existing clinical visit is by definition
--    a finished session.
-- ---------------------------------------------------------------------------

ALTER TABLE "visits"
  ADD COLUMN "scheduled_for"    TIMESTAMPTZ,
  ADD COLUMN "duration_minutes" INTEGER,
  ADD COLUMN "is_walk_in"       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "arrived_at"       TIMESTAMPTZ,
  ADD COLUMN "status"           TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_status_check"
  CHECK ("status" IN (
    'scheduled',
    'arrived',
    'in_progress',
    'completed',
    'no_show',
    'cancelled'
  ));

-- ---------------------------------------------------------------------------
-- 2. Indexes.
--
--    `(clinic_id, scheduled_for) WHERE scheduled_for IS NOT NULL`
--    powers the receptionist's calendar range queries. Partial because
--    completed clinical visits without a booking time (the doctor's
--    "[Vizitë e re]" flow) have `scheduled_for = NULL` and never
--    participate in calendar lookups; including them would bloat the
--    index for no benefit.
--
--    `(clinic_id, status)` is the Prisma-managed index from the schema
--    declaration — it appears as a separate CREATE INDEX below because
--    Prisma's `@@index` always generates one. Keeping both lets the
--    planner pick the cheaper option per query.
-- ---------------------------------------------------------------------------

CREATE INDEX "visits_clinic_scheduled_for_idx"
  ON "visits" ("clinic_id", "scheduled_for")
  WHERE "scheduled_for" IS NOT NULL;

CREATE INDEX "visits_clinic_id_status_idx"
  ON "visits" ("clinic_id", "status");

-- ---------------------------------------------------------------------------
-- 3. Drop the appointments table.
--
--    All readers are repointed at `visits` by the translation layer in
--    the same PR. RLS policy, the (clinic_id, deleted_at) index, and
--    the `set_updated_at` trigger are dropped implicitly when the
--    table goes.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS "appointments";

-- ---------------------------------------------------------------------------
-- 4. Drop the orphaned enum type.
--
--    Status now lives as TEXT + CHECK on `visits`. The old enum has
--    no remaining references.
-- ---------------------------------------------------------------------------

DROP TYPE IF EXISTS "appointment_status";
