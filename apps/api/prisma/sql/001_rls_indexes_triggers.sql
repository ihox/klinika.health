-- Klinika — manual migration: RLS, supplemental indexes, updated_at triggers.
--
-- Prisma's auto-generated migration (../20260513120000_initial/migration.sql)
-- creates the tables and basic indexes. This file layers on the parts
-- Prisma can't express:
--
--   1. Postgres Row-Level Security (ADR-005 — defense-in-depth tenancy)
--   2. The platform_admin_role (BYPASSRLS) for cross-tenant queries
--   3. Supplemental composite indexes for soft-delete and audit scans
--   4. The set_updated_at() trigger so raw-SQL writes keep updated_at fresh
--
-- This file is idempotent: each `CREATE` is wrapped in `IF NOT EXISTS` or
-- `CREATE OR REPLACE`, and each `ALTER` re-runs as a no-op.
--
-- Apply with `make db-migrate` (which runs `prisma migrate deploy` followed
-- by `psql -f` on every file in this directory) or manually:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f apps/api/prisma/sql/001_rls_indexes_triggers.sql

BEGIN;

-- ===========================================================================
-- 1. Roles
-- ===========================================================================

-- platform_admin_role: bypasses RLS for cross-tenant operations (founder
-- console, support tools, the migration tool, etc). NOLOGIN — the role
-- is acquired via `SET ROLE platform_admin_role` from an authenticated
-- application connection that has been GRANTed the role, never via a
-- direct login.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_admin_role') THEN
    CREATE ROLE platform_admin_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- klinika_app: the tenant-scoped application role. In production the
-- API connects as this role directly. In dev the connection user is
-- the database owner (superuser, BYPASSRLS) so tests demote into
-- klinika_app via `SET LOCAL ROLE klinika_app` to actually exercise
-- the RLS policies below.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'klinika_app') THEN
    CREATE ROLE klinika_app NOLOGIN;
  END IF;
END
$$;

GRANT klinika_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO klinika_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO klinika_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO klinika_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO klinika_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO klinika_app;

-- ===========================================================================
-- 2. Row-Level Security
-- ===========================================================================
--
-- Every table that carries `clinic_id` enables RLS with one policy that
-- gates SELECT, INSERT, UPDATE, and DELETE on
-- `clinic_id = current_setting('app.clinic_id')::uuid`.
--
-- `current_setting('app.clinic_id', true)` returns NULL when the setting
-- is missing (instead of raising), and the comparison evaluates to NULL
-- (treated as false), so any forgotten context check fails closed.
--
-- `FORCE ROW LEVEL SECURITY` is applied because the application user
-- typically owns the tables, and table owners bypass RLS by default
-- without FORCE.

-- ---------------------------------------------------------------------------
-- clinics — RLS scoped to `id` (the tenant's own UUID).
-- Subdomain lookup at request entry uses platform_admin_role.
-- ---------------------------------------------------------------------------
ALTER TABLE "clinics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinics" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "clinics";
CREATE POLICY tenant_isolation ON "clinics"
  USING ("id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "users";
CREATE POLICY tenant_isolation ON "users"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- patients
-- ---------------------------------------------------------------------------
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patients" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "patients";
CREATE POLICY tenant_isolation ON "patients"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- visits
-- ---------------------------------------------------------------------------
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "visits";
CREATE POLICY tenant_isolation ON "visits"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- prescription_lines
-- ---------------------------------------------------------------------------
ALTER TABLE "prescription_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "prescription_lines" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "prescription_lines";
CREATE POLICY tenant_isolation ON "prescription_lines"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- doctor_diagnosis_usage — RLS scoped to clinic_id; per-doctor rows
-- are filtered application-side. The migration that created the table
-- already set the policy, repeated here so a fresh psql -f apply is
-- idempotent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'doctor_diagnosis_usage') THEN
    EXECUTE 'ALTER TABLE "doctor_diagnosis_usage" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "doctor_diagnosis_usage" FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "doctor_diagnosis_usage"';
    EXECUTE $POL$
      CREATE POLICY tenant_isolation ON "doctor_diagnosis_usage"
        USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
    $POL$;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- visit_amendments — v1.x append-only addendum rows. Not exposed in v1
-- UI; schema-only. RLS keeps the table tenant-scoped from day one so
-- the future signing slice can assume isolation without retrofitting.
-- The migration that created the table already set the policy, repeated
-- here so a fresh `psql -f` apply is idempotent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'visit_amendments') THEN
    EXECUTE 'ALTER TABLE "visit_amendments" ENABLE ROW LEVEL SECURITY';
    EXECUTE 'ALTER TABLE "visit_amendments" FORCE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON "visit_amendments"';
    EXECUTE $POL$
      CREATE POLICY tenant_isolation ON "visit_amendments"
        USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
        WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
    $POL$;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- vertetime
-- ---------------------------------------------------------------------------
ALTER TABLE "vertetime" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vertetime" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "vertetime";
CREATE POLICY tenant_isolation ON "vertetime"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- dicom_studies
-- ---------------------------------------------------------------------------
ALTER TABLE "dicom_studies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dicom_studies" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "dicom_studies";
CREATE POLICY tenant_isolation ON "dicom_studies"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_log";
CREATE POLICY tenant_isolation ON "audit_log"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ===========================================================================
-- 3. Supplemental indexes
-- ===========================================================================
--
-- Soft-delete reads — every clinical query carries
-- `WHERE clinic_id = $1 AND deleted_at IS NULL`. A composite
-- (clinic_id, deleted_at) index is a better fit than the (clinic_id)
-- index Prisma generated, because most queries filter both columns.
-- We keep Prisma's (clinic_id) index in place — Postgres' planner will
-- pick whichever is cheaper.
--
-- The Prisma migration already created:
--   * (clinic_id, legacy_id) UNIQUE on patients and visits
--   * (clinic_id, timestamp) on audit_log
--   * (resource_type, resource_id) on audit_log
-- so they are not repeated here.

CREATE INDEX IF NOT EXISTS "users_clinic_id_deleted_at_idx"
  ON "users" ("clinic_id", "deleted_at");

CREATE INDEX IF NOT EXISTS "patients_clinic_id_deleted_at_idx"
  ON "patients" ("clinic_id", "deleted_at");

CREATE INDEX IF NOT EXISTS "visits_clinic_id_deleted_at_idx"
  ON "visits" ("clinic_id", "deleted_at");

-- ===========================================================================
-- 4. updated_at trigger
-- ===========================================================================
--
-- Prisma's `@updatedAt` only fires for writes routed through the Prisma
-- client. Raw SQL (migrations, scripts, support hot-fixes) needs the
-- database to keep `updated_at` accurate. This trigger is the source of
-- truth; Prisma's own writes still set the column but the trigger
-- overrides to a uniform `now()` on every UPDATE.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON "clinics";
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "clinics"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON "users";
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON "platform_admins";
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "platform_admins"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON "patients";
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "patients"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON "visits";
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "visits"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
