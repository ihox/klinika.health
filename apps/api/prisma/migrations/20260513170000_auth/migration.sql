-- CreateTable: auth_sessions
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "extended_ttl" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "device_label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: auth_trusted_devices
CREATE TABLE "auth_trusted_devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_trusted_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_trusted_devices_token_hash_key" ON "auth_trusted_devices"("token_hash");
CREATE INDEX "auth_trusted_devices_user_id_idx" ON "auth_trusted_devices"("user_id");
CREATE INDEX "auth_trusted_devices_expires_at_idx" ON "auth_trusted_devices"("expires_at");

ALTER TABLE "auth_trusted_devices" ADD CONSTRAINT "auth_trusted_devices_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: auth_mfa_codes
CREATE TABLE "auth_mfa_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "clinic_id" UUID NOT NULL,
    "pending_session_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumed_at" TIMESTAMPTZ(6),
    "remember_device" BOOLEAN NOT NULL DEFAULT true,
    "extended_ttl" BOOLEAN NOT NULL DEFAULT false,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_mfa_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_mfa_codes_pending_session_id_key" ON "auth_mfa_codes"("pending_session_id");
CREATE INDEX "auth_mfa_codes_user_id_idx" ON "auth_mfa_codes"("user_id");
CREATE INDEX "auth_mfa_codes_expires_at_idx" ON "auth_mfa_codes"("expires_at");

ALTER TABLE "auth_mfa_codes" ADD CONSTRAINT "auth_mfa_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: auth_login_attempts
CREATE TABLE "auth_login_attempts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email_lower" TEXT NOT NULL,
    "ip_address" INET NOT NULL,
    "user_agent" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_login_attempts_email_lower_created_at_idx" ON "auth_login_attempts"("email_lower", "created_at");
CREATE INDEX "auth_login_attempts_ip_address_created_at_idx" ON "auth_login_attempts"("ip_address", "created_at");

-- CreateTable: auth_password_reset_tokens
CREATE TABLE "auth_password_reset_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "ip_address" INET NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "auth_password_reset_tokens_token_hash_key" ON "auth_password_reset_tokens"("token_hash");
CREATE INDEX "auth_password_reset_tokens_user_id_idx" ON "auth_password_reset_tokens"("user_id");
CREATE INDEX "auth_password_reset_tokens_expires_at_idx" ON "auth_password_reset_tokens"("expires_at");

ALTER TABLE "auth_password_reset_tokens" ADD CONSTRAINT "auth_password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- CreateTable: rate_limits
CREATE TABLE "rate_limits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_ends_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_limits_scope_key" ON "rate_limits"("scope", "key");
CREATE INDEX "rate_limits_window_ends_at_idx" ON "rate_limits"("window_ends_at");
