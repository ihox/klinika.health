-- Klinika — manual migration: RLS, indexes, and trigger wiring for the
-- authentication and rate-limit tables introduced in slice-04.
--
-- This file lays on top of `20260513170000_auth` (which Prisma generated
-- the tables for) — it adds:
--
--   1. Row-Level Security policies (clinic-scoped, defense-in-depth)
--   2. The set_updated_at() trigger on the one table that needs it
--   3. Updated rate-limit cleanup helper (used by a pg-boss cron)
--
-- The auth tables intentionally do NOT mirror every clinical table's RLS
-- model. Two practical exceptions:
--
--   * `auth_login_attempts` carries no clinic_id (the email may not
--     match any user, or the row is intentionally retained for
--     forensic IP analysis across tenants). No RLS — application code
--     filters by `email_lower` and IP.
--
--   * `auth_password_reset_tokens` joins to `users` for clinic_id —
--     RLS via `user_id` is enforced by the join, not by a direct
--     column on this row.
--
--   * `rate_limits` is scope-bucket → counter; many scopes (login.ip)
--     pre-date tenant context. No RLS.
--
-- Apply via `make db-migrate`, which runs every file in this directory
-- in lexical order after `prisma migrate deploy`.

BEGIN;

-- ===========================================================================
-- 1. Row-Level Security
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- auth_sessions — RLS via clinic_id (denormalised at insert time).
-- ---------------------------------------------------------------------------
ALTER TABLE "auth_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_sessions" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "auth_sessions";
CREATE POLICY tenant_isolation ON "auth_sessions"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- auth_trusted_devices
-- ---------------------------------------------------------------------------
ALTER TABLE "auth_trusted_devices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_trusted_devices" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "auth_trusted_devices";
CREATE POLICY tenant_isolation ON "auth_trusted_devices"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- auth_mfa_codes
-- ---------------------------------------------------------------------------
ALTER TABLE "auth_mfa_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_mfa_codes" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "auth_mfa_codes";
CREATE POLICY tenant_isolation ON "auth_mfa_codes"
  USING ("clinic_id" = current_setting('app.clinic_id', true)::uuid)
  WITH CHECK ("clinic_id" = current_setting('app.clinic_id', true)::uuid);

-- ===========================================================================
-- 2. updated_at trigger on rate_limits
-- ===========================================================================
--
-- rate_limits is the only new table with a meaningful `updated_at`
-- (counter increments). Trigger keeps it in lockstep with Prisma's
-- `@updatedAt` for raw-SQL writes.

DROP TRIGGER IF EXISTS set_updated_at ON "rate_limits";
CREATE TRIGGER set_updated_at BEFORE UPDATE ON "rate_limits"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ===========================================================================
-- 3. Cleanup helpers (called by pg-boss cron in apps/api)
-- ===========================================================================

CREATE OR REPLACE FUNCTION purge_expired_auth()
RETURNS TABLE (sessions INT, mfa_codes INT, password_resets INT, trusted_devices INT, login_attempts INT, rate_limits INT) AS $$
DECLARE
  v_sessions INT;
  v_mfa INT;
  v_pwd INT;
  v_trusted INT;
  v_attempts INT;
  v_rate INT;
BEGIN
  -- Hard-delete here is intentional: auth tables hold transient
  -- material (sessions, codes), not patient data. Soft-delete is a
  -- CLAUDE.md §1.7 rule for clinical records.
  DELETE FROM "auth_sessions" WHERE "expires_at" < now() OR ("revoked_at" IS NOT NULL AND "revoked_at" < now() - interval '30 days');
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  DELETE FROM "auth_mfa_codes" WHERE "expires_at" < now() - interval '1 day';
  GET DIAGNOSTICS v_mfa = ROW_COUNT;

  DELETE FROM "auth_password_reset_tokens" WHERE "expires_at" < now() - interval '7 days';
  GET DIAGNOSTICS v_pwd = ROW_COUNT;

  DELETE FROM "auth_trusted_devices" WHERE "expires_at" < now() OR ("revoked_at" IS NOT NULL AND "revoked_at" < now() - interval '30 days');
  GET DIAGNOSTICS v_trusted = ROW_COUNT;

  DELETE FROM "auth_login_attempts" WHERE "created_at" < now() - interval '90 days';
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  DELETE FROM "rate_limits" WHERE "window_ends_at" < now() - interval '1 hour';
  GET DIAGNOSTICS v_rate = ROW_COUNT;

  RETURN QUERY SELECT v_sessions, v_mfa, v_pwd, v_trusted, v_attempts, v_rate;
END;
$$ LANGUAGE plpgsql;

COMMIT;
