-- Phase 2a fix — walk-in pairing rule.
--
-- A walk-in represents a patient who arrived without booking while
-- another patient is being seen. The pairing is *logical* (they share
-- a visual row in the receptionist's two-lane calendar), not temporal
-- — the walk-in's `arrived_at` stays independent of the paired
-- visit's `scheduled_for`. See CLAUDE.md §13 walk-in pairing rule.
--
-- This migration:
--   1. Adds `paired_with_visit_id UUID NULL` referencing visits(id).
--   2. CHECK: paired_with_visit_id can only be set when is_walk_in = true.
--      Scheduled rows must never claim a pairing. The walk-in side is
--      enforced by the service layer, not the DB (an FK is sufficient).
--   3. Partial index for the inverse lookup (paired walk-ins per
--      scheduled visit). Skips NULLs so the index stays small.

ALTER TABLE "visits"
  ADD COLUMN "paired_with_visit_id" UUID NULL
  REFERENCES "visits"("id") ON DELETE SET NULL;

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_paired_with_only_for_walkins_check"
  CHECK ("paired_with_visit_id" IS NULL OR "is_walk_in" = TRUE);

CREATE INDEX "visits_paired_with_visit_id_idx"
  ON "visits" ("paired_with_visit_id")
  WHERE "paired_with_visit_id" IS NOT NULL;
