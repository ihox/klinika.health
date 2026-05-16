-- Migration support: preserve the original Access "Emri dhe mbiemri"
-- string on every imported patient row.
--
-- The Access source uses trailing asterisks ("Rita Hoxha*", "Jon
-- Gashi **") as a uniqueness workaround for duplicate names — there
-- are ~462 such patients across the ~11,165-row dataset. ADR-010
-- specifies that asterisks are stripped from first_name/last_name
-- on import. To keep the visit-import phase able to resolve
-- `Vizitat.x` (which still carries the starred form) back to a
-- patient, we store the original display name verbatim in
-- `legacy_display_name` and mark `has_name_duplicate = true` so the
-- UI can surface a "shared name" warning chip later.
--
-- Both columns are nullable / default-false so post-migration
-- patients created via the receptionist or doctor UI need no
-- backfill — they sit at NULL / false naturally.
--
-- Forward-only and idempotent: the IF NOT EXISTS clauses make the
-- migration safe to replay against a database that already has the
-- columns (re-runnable per ADR-010's idempotent migration philosophy).

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "legacy_display_name" TEXT,
  ADD COLUMN IF NOT EXISTS "has_name_duplicate" BOOLEAN NOT NULL DEFAULT false;

-- Index supports the O(1) lookup in visit-import: for each
-- `Vizitat.x` we resolve patient_id by (clinic_id, legacy_display_name).
-- ~11,165 rows, so the index is small (~hundreds of KB).
CREATE INDEX IF NOT EXISTS "patient_clinic_legacy_display_name_idx"
  ON "patients" ("clinic_id", "legacy_display_name");
