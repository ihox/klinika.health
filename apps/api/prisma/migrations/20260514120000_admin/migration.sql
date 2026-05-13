-- CreateTable: auth_admin_sessions
CREATE TABLE "auth_admin_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "device_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "auth_admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_admin_sessions_token_hash_key" ON "auth_admin_sessions"("token_hash");
CREATE INDEX "auth_admin_sessions_platform_admin_id_idx" ON "auth_admin_sessions"("platform_admin_id");
CREATE INDEX "auth_admin_sessions_expires_at_idx" ON "auth_admin_sessions"("expires_at");

ALTER TABLE "auth_admin_sessions" ADD CONSTRAINT "auth_admin_sessions_platform_admin_id_fkey"
    FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: auth_admin_mfa_codes
CREATE TABLE "auth_admin_mfa_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_admin_id" UUID NOT NULL,
    "pending_session_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_admin_mfa_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_admin_mfa_codes_pending_session_id_key" ON "auth_admin_mfa_codes"("pending_session_id");
CREATE INDEX "auth_admin_mfa_codes_platform_admin_id_idx" ON "auth_admin_mfa_codes"("platform_admin_id");
CREATE INDEX "auth_admin_mfa_codes_expires_at_idx" ON "auth_admin_mfa_codes"("expires_at");

ALTER TABLE "auth_admin_mfa_codes" ADD CONSTRAINT "auth_admin_mfa_codes_platform_admin_id_fkey"
    FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: platform_audit_log
CREATE TABLE "platform_audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "platform_admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_clinic_id" UUID,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" JSONB,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_log_platform_admin_id_timestamp_idx" ON "platform_audit_log"("platform_admin_id", "timestamp");
CREATE INDEX "platform_audit_log_target_clinic_id_timestamp_idx" ON "platform_audit_log"("target_clinic_id", "timestamp");
CREATE INDEX "platform_audit_log_action_timestamp_idx" ON "platform_audit_log"("action", "timestamp");

ALTER TABLE "platform_audit_log" ADD CONSTRAINT "platform_audit_log_platform_admin_id_fkey"
    FOREIGN KEY ("platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
