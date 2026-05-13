-- Klinika — manual migration: admin auth cleanup helpers (slice-05).
--
-- The admin auth tables (`auth_admin_sessions`, `auth_admin_mfa_codes`)
-- intentionally do NOT have RLS:
--
--   * Platform admins are cross-tenant by design (ADR-005). Setting
--     `app.clinic_id` for an admin login flow would require choosing a
--     tenant; there isn't one.
--   * The application layer enforces "must be authenticated admin"
--     via AdminAuthGuard on every `/api/admin/*` route. The tables
--     are reachable only from controllers that already gate access.
--   * `platform_audit_log` is shared across all admins (no per-row
--     ownership), so RLS would add no value.
--
-- What this file does add is the cleanup function for transient admin
-- auth material, mirroring `purge_expired_auth()` from 002_auth_rls.sql
-- but for the admin tables. pg-boss cron runs both daily.

BEGIN;

CREATE OR REPLACE FUNCTION purge_expired_admin_auth()
RETURNS TABLE (admin_sessions INT, admin_mfa_codes INT) AS $$
DECLARE
  v_sessions INT;
  v_mfa INT;
BEGIN
  -- Hard delete (these are transient credentials, not clinical data).
  DELETE FROM "auth_admin_sessions"
   WHERE "expires_at" < now()
      OR ("revoked_at" IS NOT NULL AND "revoked_at" < now() - interval '30 days');
  GET DIAGNOSTICS v_sessions = ROW_COUNT;

  DELETE FROM "auth_admin_mfa_codes" WHERE "expires_at" < now() - interval '1 day';
  GET DIAGNOSTICS v_mfa = ROW_COUNT;

  RETURN QUERY SELECT v_sessions, v_mfa;
END;
$$ LANGUAGE plpgsql;

COMMIT;
