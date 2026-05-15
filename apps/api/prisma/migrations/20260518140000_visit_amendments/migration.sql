-- v1.x: visit amendments — NOT exposed in v1 UI.
--
-- Append-only addendum rows attached to a visit. After a visit is
-- electronically signed (see `visits.signed_at` from migration
-- 20260518130000), the doctor's corrections / clarifications are
-- expected to land here instead of mutating the original visit
-- record — preserving the clinical audit trail in the form regulators
-- recognise (original entry + dated amendments, all by name).
--
-- v1 UI never reads or writes this table. The schema is here so the
-- v1.x amendments slice can ship without a painful migration. Tests
-- in v1 verify only that the table exists and accepts inserts; the
-- API surface and chart UI land later.
--
-- Convention deviations from the original brief:
--   * Timestamps: brief specified `TIMESTAMP NOT NULL DEFAULT NOW()`;
--     using TIMESTAMPTZ(6) per CLAUDE.md §5.6 (project-wide UTC).
--   * Adds `clinic_id` (not in the brief): required for the
--     tenant-isolation RLS policy that every clinical table carries
--     (CLAUDE.md §1.6). Without it, RLS can't scope rows by tenant.
--     Sourced from the parent visit at insert time; the application
--     layer is responsible for keeping it in sync with `visits.clinic_id`
--     on the parent row (a trigger could enforce this, but we follow
--     the existing pattern — visit_diagnoses, visit_clear_snapshots
--     both carried clinic_id without a trigger and the rule held).
--
-- Indexes:
--   * (visit_id) — primary query path: "amendments for this visit"
--   * (author_user_id) — admin / audit query path: "amendments by Dr. X"
--   * (clinic_id) — RLS planner hint (USING clause inspects this col)
--
-- Foreign keys:
--   * visit_id → visits(id) ON DELETE CASCADE
--     A soft-deleted-then-hard-purged visit (admin tooling only)
--     should not leave dangling amendments.
--   * author_user_id → users(id) ON DELETE RESTRICT
--     A user with amendments on file cannot be hard-deleted. Soft
--     delete (users.deleted_at) is unaffected — the row stays, the
--     amendment stays attributed to the original author. The RESTRICT
--     guards against accidental cascade loss of authorship.
--   * clinic_id → clinics(id) ON DELETE NO ACTION (project default)
--
-- Rollback (forward migration):
--   DROP TABLE IF EXISTS "visit_amendments";
--   -- (cascades indexes, FKs, and the RLS policy)

CREATE TABLE "visit_amendments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clinic_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "visit_amendments_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "visit_amendments_visit_id_idx"
    ON "visit_amendments"("visit_id");

CREATE INDEX "visit_amendments_author_user_id_idx"
    ON "visit_amendments"("author_user_id");

CREATE INDEX "visit_amendments_clinic_id_idx"
    ON "visit_amendments"("clinic_id");

-- Foreign keys
ALTER TABLE "visit_amendments"
    ADD CONSTRAINT "visit_amendments_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "visit_amendments"
    ADD CONSTRAINT "visit_amendments_visit_id_fkey"
    FOREIGN KEY ("visit_id") REFERENCES "visits"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "visit_amendments"
    ADD CONSTRAINT "visit_amendments_author_user_id_fkey"
    FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

-- RLS — tenant isolation. Mirrors the policy on every clinic-scoped
-- table (canonical pattern in prisma/sql/001_rls_indexes_triggers.sql).
-- The bootstrap SQL file gets a matching idempotent block so a fresh
-- `psql -f 001_rls_indexes_triggers.sql` re-applies the policy after
-- a `prisma migrate reset`.
ALTER TABLE "visit_amendments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visit_amendments" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "visit_amendments";
CREATE POLICY tenant_isolation ON "visit_amendments"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);
