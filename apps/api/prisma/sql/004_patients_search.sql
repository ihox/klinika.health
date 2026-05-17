-- Klinika — manual migration: patient search indexes.
--
-- Slice 7 enables fuzzy, diacritic-insensitive search over patient
-- first/last name. We use:
--
--   * pg_trgm  — trigram similarity for "Hoxa" → "Hoxha"
--   * unaccent — strips diacritics so "Çekaj" matches "Cekaj"
--
-- An IMMUTABLE wrapper (`klinika_unaccent_lower`) is required because
-- Postgres' built-in `unaccent()` is marked STABLE — `STABLE` functions
-- cannot be used in functional indexes. The wrapper composes
-- `unaccent` with `lower` and is marked IMMUTABLE; this is safe because
-- the underlying unaccent rule set ships with the extension and never
-- changes at runtime.
--
-- The GIN trigram indexes match the queries built by PatientsService
-- (`klinika_unaccent_lower(first_name || ' ' || last_name) %% $query`).
--
-- Idempotent: every CREATE uses IF NOT EXISTS / OR REPLACE.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------------
-- 2. IMMUTABLE helper
-- ---------------------------------------------------------------------------
--
-- `unaccent(text)` is STABLE because its behaviour depends on a
-- configurable dictionary. The two-argument form (`unaccent('unaccent',
-- text)`) names the dictionary explicitly and can be wrapped as
-- IMMUTABLE — this is the documented pattern for using unaccent in
-- functional indexes.

CREATE OR REPLACE FUNCTION klinika_unaccent_lower(text)
RETURNS text AS $$
  SELECT lower(unaccent('unaccent', $1))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

-- ---------------------------------------------------------------------------
-- 3. Trigram indexes
-- ---------------------------------------------------------------------------
--
-- Two GIN indexes — one per name column — so `% query` predicates can
-- short-circuit on either side. The combined index variant (concat of
-- first_name + ' ' + last_name) is added because the most common query
-- types "Era Hox" matches both columns at once.

CREATE INDEX IF NOT EXISTS "patients_first_name_trgm_idx"
  ON "patients" USING gin (klinika_unaccent_lower("first_name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_last_name_trgm_idx"
  ON "patients" USING gin (klinika_unaccent_lower("last_name") gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "patients_full_name_trgm_idx"
  ON "patients" USING gin (
    klinika_unaccent_lower("first_name" || ' ' || "last_name") gin_trgm_ops
  );

-- legacy_id is INTEGER — searched by exact match, no trigram needed.
-- date_of_birth is DATE — searched by EXTRACT(YEAR …) for the year
-- boost and by direct equality for the full-DOB boost. A plain B-tree
-- supports the equality probe; the year extraction stays a sequential
-- evaluation inside whichever rowset the planner already produced.

CREATE INDEX IF NOT EXISTS "patients_date_of_birth_idx"
  ON "patients" USING btree ("date_of_birth");

COMMIT;
