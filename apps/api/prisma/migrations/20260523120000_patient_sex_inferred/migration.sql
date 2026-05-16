-- Migration support: audit trail for sex values populated by the
-- Slice 17.5 name-to-sex inference pass.
--
-- The Access source (PEDIATRIA.accdb) had no gender column, so all
-- 10,605 migrated DonetaMED patients land with `sex IS NULL`.
-- Albanian/Kosovan first names are strongly gendered, so we infer
-- sex from first_name via a Claude-generated dictionary
-- (tools/migrate/klinika_migrate/sex_inference.py).
--
-- `sex_inferred=true` marks a row whose sex was set by the
-- inference pass — apply-sex-inference is allowed to overwrite
-- these on re-run. `sex_inferred=false` marks a row whose sex was
-- set manually (doctor edit, post-migration patient creation) and
-- is therefore off-limits to the inference pass.
--
-- Default is false: a brand-new patient created via the UI has
-- sex set explicitly (or left NULL), and that NULL/value reflects
-- the doctor's choice, not an inference.
--
-- Forward-only and idempotent (ADR-010): IF NOT EXISTS allows
-- replay against a database that already has the column.

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "sex_inferred" BOOLEAN NOT NULL DEFAULT false;
