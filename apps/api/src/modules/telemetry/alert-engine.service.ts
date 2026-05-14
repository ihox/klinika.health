import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import type { HeartbeatPayload } from './telemetry.types';

const TENANT_OFFLINE_THRESHOLD_MS = 5 * 60 * 1000;
// ADR-009: alerts at 80% and 95% of disk capacity. The warning
// threshold leaves headroom for the operator to provision more
// storage / archive before reaching critical.
const DISK_CRITICAL_PERCENT = 95;
const DISK_WARNING_PERCENT = 80;
const BACKUP_STALE_HOURS = 30;

export type AlertKind =
  | 'tenant_offline'
  | 'disk_critical'
  | 'disk_warning'
  | 'backup_failed'
  | 'orthanc_down'
  | 'db_down'
  | 'app_unhealthy';

export interface DerivedAlert {
  tenantId: string;
  kind: AlertKind;
  severity: 'critical' | 'warning';
  message: string;
  dedupeKey: string;
}

/**
 * Centralises the rules that turn a single heartbeat into alerts.
 * Pure-ish: `derive()` is a synchronous function over the payload plus
 * "what other tenants are also offline right now". Side-effects
 * (writing alert rows, scheduling notifications) live in `persist()`.
 *
 * Critical alerts get `notifiedAt` set on first occurrence and fire an
 * immediate notification (email; SMS hook reserved for v1.5). Warning
 * alerts collect for the 9am digest.
 *
 * Smart grouping: if simultaneously-offline tenants exceed a small
 * threshold (>=3 distinct tenants within 5 minutes), the per-tenant
 * `tenant_offline` alerts are downgraded — one platform-wide
 * "multi-tenant outage" alert fires instead. The pattern recognizes
 * shared infrastructure issues without spamming.
 */
@Injectable()
export class AlertEngineService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AlertEngineService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Evaluate this heartbeat for alert conditions and persist anything
   * new. Returns the alerts produced for this call (useful for tests).
   */
  async evaluate(
    tenantId: string,
    payload: HeartbeatPayload,
  ): Promise<DerivedAlert[]> {
    const derived = this.derive(tenantId, payload, new Date());
    for (const alert of derived) {
      await this.persist(alert);
    }
    return derived;
  }

  /** Pure: given a payload, return zero-or-more alerts. Tested directly. */
  derive(
    tenantId: string,
    payload: HeartbeatPayload,
    now: Date,
  ): DerivedAlert[] {
    const alerts: DerivedAlert[] = [];

    if (payload.diskPercent >= DISK_CRITICAL_PERCENT) {
      alerts.push({
        tenantId,
        kind: 'disk_critical',
        severity: 'critical',
        message: `Disk usage on ${tenantId} is ${payload.diskPercent.toFixed(1)}%`,
        dedupeKey: `disk_critical:${tenantId}:${dayKey(now)}`,
      });
    } else if (payload.diskPercent >= DISK_WARNING_PERCENT) {
      alerts.push({
        tenantId,
        kind: 'disk_warning',
        severity: 'warning',
        message: `Disk usage on ${tenantId} is ${payload.diskPercent.toFixed(1)}%`,
        dedupeKey: `disk_warning:${tenantId}:${dayKey(now)}`,
      });
    }

    if (!payload.dbHealthy) {
      alerts.push({
        tenantId,
        kind: 'db_down',
        severity: 'critical',
        message: `Database unreachable on ${tenantId}`,
        dedupeKey: `db_down:${tenantId}:${hourKey(now)}`,
      });
    }

    if (!payload.orthancHealthy && payload.orthancHealthy !== undefined) {
      // Warning, not critical — DICOM going offline degrades but
      // doesn't stop the clinic.
      alerts.push({
        tenantId,
        kind: 'orthanc_down',
        severity: 'warning',
        message: `Orthanc DICOM server unreachable on ${tenantId}`,
        dedupeKey: `orthanc_down:${tenantId}:${hourKey(now)}`,
      });
    }

    if (!payload.appHealthy) {
      alerts.push({
        tenantId,
        kind: 'app_unhealthy',
        severity: 'critical',
        message: `App reported unhealthy on ${tenantId}`,
        dedupeKey: `app_unhealthy:${tenantId}:${hourKey(now)}`,
      });
    }

    if (payload.lastBackupAt) {
      const lastBackup = new Date(payload.lastBackupAt);
      const ageHours = (now.getTime() - lastBackup.getTime()) / 3_600_000;
      if (ageHours > BACKUP_STALE_HOURS) {
        alerts.push({
          tenantId,
          kind: 'backup_failed',
          severity: 'critical',
          message: `Backup stale on ${tenantId}: last success ${ageHours.toFixed(1)}h ago`,
          dedupeKey: `backup_failed:${tenantId}:${dayKey(now)}`,
        });
      }
    }

    return alerts;
  }

  /**
   * Scan recent heartbeats to find tenants that haven't checked in for
   * more than the offline threshold. Called by the platform-side
   * `telemetry.tenant-offline-sweep` scheduled job, not by the
   * receiver — the receiver only sees alive tenants.
   */
  async detectOfflineTenants(now: Date = new Date()): Promise<DerivedAlert[]> {
    const cutoff = new Date(now.getTime() - TENANT_OFFLINE_THRESHOLD_MS);
    // Find tenants whose most-recent heartbeat is older than the
    // cutoff. We don't have a "tenants" registry yet (that lives on
    // the platform side, later); for now we approximate with the
    // distinct tenant_ids seen in the last 24h.
    type Row = { tenant_id: string; latest: Date };
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT tenant_id, MAX(received_at) AS latest
        FROM telemetry_heartbeats
       WHERE received_at > ${new Date(now.getTime() - 24 * 3_600_000)}
    GROUP BY tenant_id
      HAVING MAX(received_at) < ${cutoff}
    `;

    const offline = rows.map(
      (r): DerivedAlert => ({
        tenantId: r.tenant_id,
        kind: 'tenant_offline',
        severity: 'critical',
        message: `Tenant ${r.tenant_id} offline since ${r.latest.toISOString()}`,
        dedupeKey: `tenant_offline:${r.tenant_id}:${windowKey(now, 5)}`,
      }),
    );

    // Smart grouping: 3+ tenants offline simultaneously → single
    // multi-tenant alert. We still persist the per-tenant rows so
    // operators can see the affected list, but flip their severity
    // to warning so only ONE critical fires.
    if (offline.length >= 3) {
      const group: DerivedAlert = {
        tenantId: 'platform',
        kind: 'tenant_offline',
        severity: 'critical',
        message: `Multi-tenant outage: ${offline.length} tenants offline (${offline.map((o) => o.tenantId).join(', ')})`,
        dedupeKey: `tenant_offline:platform:${windowKey(now, 5)}`,
      };
      for (const o of offline) {
        o.severity = 'warning';
      }
      offline.push(group);
    }

    for (const alert of offline) {
      await this.persist(alert);
    }
    return offline;
  }

  /**
   * Insert (or skip) an alert. Dedupe is enforced at the application
   * layer by `dedupeKey` — repeated identical conditions within the
   * same time window resolve to a single row. Critical alerts get
   * `notifiedAt` set when first inserted; warnings get `digestedAt =
   * null` and are picked up by the daily digest job.
   */
  async persist(alert: DerivedAlert): Promise<void> {
    try {
      const existing = await this.prisma.telemetryAlert.findFirst({
        where: { dedupeKey: alert.dedupeKey },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        return;
      }
      await this.prisma.telemetryAlert.create({
        data: {
          tenantId: alert.tenantId,
          severity: alert.severity,
          kind: alert.kind,
          message: alert.message,
          dedupeKey: alert.dedupeKey,
          notifiedAt: alert.severity === 'critical' ? new Date() : null,
        },
      });
      this.logger.info(
        {
          tenantId: alert.tenantId,
          kind: alert.kind,
          severity: alert.severity,
        },
        'Telemetry alert raised',
      );
    } catch (err) {
      this.logger.error({ err, alert }, 'Failed to persist telemetry alert');
    }
  }
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hourKey(d: Date): string {
  return d.toISOString().slice(0, 13);
}

function windowKey(d: Date, minutes: number): string {
  const ms = minutes * 60_000;
  const bucket = Math.floor(d.getTime() / ms) * ms;
  return new Date(bucket).toISOString();
}
