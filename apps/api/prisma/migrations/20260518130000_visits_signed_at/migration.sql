-- v1.x: electronic signing — NOT exposed in v1 UI.
--
-- Adds a `signed_at` timestamp to `visits`. A non-NULL value indicates
-- the visit has been electronically signed by the attending doctor;
-- after signing, further edits are expected to flow through the
-- `visit_amendments` table (companion migration
-- 20260518140000_visit_amendments) rather than mutating the original
-- row. v1 UI never reads or writes this column — the schema is here
-- so the v1.x signing slice can ship without a painful migration.
--
-- Convention deviation: the original brief asked for `TIMESTAMP NULL`.
-- Project-wide policy (CLAUDE.md §5.6) is `TIMESTAMPTZ` in UTC. Using
-- TIMESTAMPTZ(6) to match every other timestamp column on `visits`
-- (created_at, updated_at, deleted_at) and the rest of the schema.
--
-- Index: regular btree on `signed_at`. Postgres btree indexes NULLs,
-- so the planner can satisfy both "WHERE signed_at IS NULL"
-- (find-unsigned, the brief's stated use case) and the inverse
-- "WHERE signed_at IS NOT NULL" / ORDER BY signed_at queries from
-- the same index. We'll add composite indexes (e.g. clinic_id,
-- signed_at) if and when query patterns from the signing slice
-- justify them.
--
-- Rollback (forward-migration style — Prisma doesn't generate down
-- migrations; the project's runbook is "write a follow-up migration
-- that undoes the change"):
--   DROP INDEX IF EXISTS "visits_signed_at_idx";
--   ALTER TABLE "visits" DROP COLUMN IF EXISTS "signed_at";

ALTER TABLE "visits"
  ADD COLUMN "signed_at" TIMESTAMPTZ(6);

CREATE INDEX "visits_signed_at_idx" ON "visits"("signed_at");
