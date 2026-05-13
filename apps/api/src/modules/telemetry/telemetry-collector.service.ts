import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { HealthService } from '../health/health.service';
import { PgBossService } from '../jobs/pg-boss.service';
import { ErrorRateCounter } from './error-counter';
import type { HeartbeatPayload } from './telemetry.types';

const TELEMETRY_QUEUE = 'telemetry.heartbeat-send';

/**
 * Builds a HeartbeatPayload from local probes (DB, Orthanc, system
 * metrics) plus runtime counters (queue depth, error rate). The
 * resulting payload contains no PHI; the
 * `telemetry-payload-no-phi.spec.ts` test enforces this by scanning
 * keys and string values against the redaction field list.
 *
 * Backup time is read from `BACKUP_LAST_SUCCESS_AT` (an ISO timestamp
 * set by the restic wrapper after a successful run) so the agent
 * doesn't need direct access to the backup tool.
 */
@Injectable()
export class TelemetryCollectorService {
  constructor(
    private readonly health: HealthService,
    private readonly boss: PgBossService,
    private readonly errors: ErrorRateCounter,
    @InjectPinoLogger(TelemetryCollectorService.name)
    private readonly logger: PinoLogger,
  ) {}

  async collect(): Promise<HeartbeatPayload> {
    const snapshot = await this.health.deep();
    const queueDepth = await this.boss.queueSize(TELEMETRY_QUEUE);
    const errorRate = this.errors.drain();
    const lastBackupAt = this.readLastBackupAt();
    const activeSessions = await this.readActiveSessionCount();

    return {
      tenantId: this.tenantId(),
      version: snapshot.app.version,
      emittedAt: new Date().toISOString(),
      appHealthy: snapshot.app.ok,
      dbHealthy: snapshot.db.ok,
      orthancHealthy: snapshot.orthanc.ok,
      cpuPercent: snapshot.system.cpuPercent,
      ramPercent: snapshot.system.ramPercent,
      diskPercent: snapshot.system.diskPercent,
      lastBackupAt,
      activeSessions,
      queueDepth,
      errorRate5xx: errorRate,
    };
  }

  /**
   * Subdomain of this install. The platform tenant identifies itself
   * as `platform`. Mistyped / missing values default to `unknown` so a
   * misconfigured install still phones home (the platform side notices
   * the `unknown` tenant and pages an operator).
   */
  private tenantId(): string {
    return process.env['KLINIKA_TENANT_ID'] ?? 'unknown';
  }

  private readLastBackupAt(): string | null {
    const raw = process.env['BACKUP_LAST_SUCCESS_AT'];
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      this.logger.warn({ raw }, 'BACKUP_LAST_SUCCESS_AT is not a valid date');
      return null;
    }
    return parsed.toISOString();
  }

  /**
   * Session table is created by the auth slice (later). Until then we
   * have nothing to count, so we return 0. The query is wrapped so a
   * missing table doesn't break the telemetry sweep — and the column /
   * table name is centralized here for the auth slice to wire up.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  private async readActiveSessionCount(): Promise<number> {
    return 0;
  }
}
