-- Phase 2c — "Pastro vizitën" undo snapshot.
--
-- Captures a visit's clinical fields the moment the doctor clicks
-- "Pastro vizitën" so the action can be reversed within a 15-second
-- window. `expires_at` carries the deadline; the undo endpoint
-- accepts only rows where `expires_at > now()` and then DELETEs the
-- row on a successful restore.
--
-- Keyed unique on `visit_id` (one pending snapshot per visit). A
-- subsequent clear of the same visit upserts the row, so the table
-- never accumulates more than one row per visit. Stale rows after
-- expiry sit harmlessly until the next clear or a future sweep job.
--
-- ON DELETE CASCADE on the visit FK so a hard-deleted visit (admin
-- tooling only — soft delete is the v1 path) doesn't leave dangling
-- snapshots.

-- CreateTable
CREATE TABLE "visit_clear_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "fields" JSONB NOT NULL,
    "diagnoses" JSONB NOT NULL,
    "previous_status" TEXT NOT NULL,
    "cleared_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "visit_clear_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_clear_snapshots_visit_id_key"
    ON "visit_clear_snapshots"("visit_id");

-- CreateIndex
CREATE INDEX "visit_clear_snapshots_clinic_id_idx"
    ON "visit_clear_snapshots"("clinic_id");

-- CreateIndex
CREATE INDEX "visit_clear_snapshots_expires_at_idx"
    ON "visit_clear_snapshots"("expires_at");

-- AddForeignKey
ALTER TABLE "visit_clear_snapshots" ADD CONSTRAINT "visit_clear_snapshots_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "visit_clear_snapshots" ADD CONSTRAINT "visit_clear_snapshots_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- RLS — tenant isolation. Mirrors the policy on every clinic-scoped
-- table (see prisma/sql/001_rls_indexes_triggers.sql for the canonical
-- pattern).
ALTER TABLE "visit_clear_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_clear_snapshots" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "visit_clear_snapshots";
CREATE POLICY tenant_isolation ON "visit_clear_snapshots"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);
