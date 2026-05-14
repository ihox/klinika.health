-- Slice 17 — multi-role users.
--
-- Migrates `users.role` (single `user_role` enum) → `users.roles`
-- (TEXT[]) so a single user can carry any combination of the three
-- clinic roles {doctor, receptionist, clinic_admin}.
--
-- Motivation: small clinics have people wearing multiple hats. At
-- DonetaMED, Dr. Taulant Shala is both the doctor AND the clinic
-- admin — not two accounts. The previous single-role model forced an
-- artificial separation. See ADR-004 (Multi-role update).
--
-- Plan:
--   1. Add `roles TEXT[] NOT NULL DEFAULT '{}'` (empty default lets
--      the column be NOT NULL during the backfill).
--   2. Backfill every existing user to a one-element array derived
--      from the old enum column.
--   3. Drop the old `role` column and the `user_role` enum (nothing
--      else references it).
--   4. Add CHECK constraints — non-empty, at most 3 elements, and
--      only the three permitted values.

-- ---------------------------------------------------------------------------
-- 1 + 2. Add the new column and backfill from the existing enum.
-- ---------------------------------------------------------------------------

ALTER TABLE "users"
  ADD COLUMN "roles" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "users"
  SET "roles" = ARRAY["role"::TEXT]::TEXT[];

-- ---------------------------------------------------------------------------
-- 3. Drop the old column and the now-orphaned enum type.
-- ---------------------------------------------------------------------------

ALTER TABLE "users" DROP COLUMN "role";
DROP TYPE "user_role";

-- ---------------------------------------------------------------------------
-- 4. CHECK constraints.
--
--    `cardinality()` returns 0 for the empty array, so the BETWEEN
--    check rejects both empty and >3-element arrays. (`array_length`
--    returns NULL for an empty array, which CHECK would silently
--    accept — that's why we use cardinality here.)
--
--    `<@` is the "is-contained-by" array operator: every element of
--    `roles` must be in the allow-list.
-- ---------------------------------------------------------------------------

ALTER TABLE "users"
  ADD CONSTRAINT "users_roles_size_check"
  CHECK (cardinality("roles") BETWEEN 1 AND 3);

ALTER TABLE "users"
  ADD CONSTRAINT "users_roles_allowed_check"
  CHECK ("roles" <@ ARRAY['doctor', 'receptionist', 'clinic_admin']::TEXT[]);
