-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('critical', 'warning');

-- CreateTable
CREATE TABLE "telemetry_heartbeats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emitted_at" TIMESTAMPTZ(6) NOT NULL,
    "app_healthy" BOOLEAN NOT NULL,
    "db_healthy" BOOLEAN NOT NULL,
    "orthanc_healthy" BOOLEAN NOT NULL,
    "cpu_percent" DECIMAL(5,2) NOT NULL,
    "ram_percent" DECIMAL(5,2) NOT NULL,
    "disk_percent" DECIMAL(5,2) NOT NULL,
    "last_backup_at" TIMESTAMPTZ(6),
    "active_sessions" INTEGER NOT NULL,
    "queue_depth" INTEGER NOT NULL,
    "error_rate_5xx" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "telemetry_heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" TEXT NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "notified_at" TIMESTAMPTZ(6),
    "digested_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "telemetry_heartbeats_tenant_id_received_at_idx" ON "telemetry_heartbeats"("tenant_id", "received_at");

-- CreateIndex
CREATE INDEX "telemetry_heartbeats_received_at_idx" ON "telemetry_heartbeats"("received_at");

-- CreateIndex
CREATE INDEX "telemetry_alerts_tenant_id_created_at_idx" ON "telemetry_alerts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "telemetry_alerts_dedupe_key_idx" ON "telemetry_alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "telemetry_alerts_severity_notified_at_idx" ON "telemetry_alerts"("severity", "notified_at");
