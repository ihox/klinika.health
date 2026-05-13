import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { HealthService } from '../health/health.service';
import type { PlatformHealthSnapshot } from './admin.dto';

const ACTIVE_USER_WINDOW_MS = 24 * 60 * 60_000; // last 24h
const VISITS_THIS_MONTH_FROM_DAY = 1;
const HEARTBEAT_FRESHNESS_MS = 10 * 60_000;
const RECENT_ALERTS_LIMIT = 20;

/**
 * Aggregates a platform-wide view of every tenant for the
 * `/admin/health` dashboard. All numbers are computed at request time
 * — no caching layer — because the dashboard polls every 60s and the
 * scale (a handful of clinics) makes the aggregations cheap.
 *
 * If/when we cross ~50 tenants we'll either:
 *   1. Materialise nightly into a `platform_health_snapshot` table, or
 *   2. Switch to streaming heartbeats into a TS DB.
 *
 * Until then, the simplicity of "join + count" wins.
 */
@Injectable()
export class AdminHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly health: HealthService,
  ) {}

  async snapshot(): Promise<PlatformHealthSnapshot> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), VISITS_THIS_MONTH_FROM_DAY);
    const activeUserCutoff = new Date(now.getTime() - ACTIVE_USER_WINDOW_MS);
    const heartbeatCutoff = new Date(now.getTime() - HEARTBEAT_FRESHNESS_MS);

    const [
      clinicCounts,
      userTotal,
      activeUsers,
      patientTotal,
      visitsThisMonth,
      latestHeartbeats,
      recentAlerts,
      dbProbe,
    ] = await Promise.all([
      this.prisma.clinic.groupBy({
        by: ['status'],
        where: { deletedAt: null },
        _count: true,
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: { deletedAt: null, lastLoginAt: { gte: activeUserCutoff } },
      }),
      this.prisma.patient.count({ where: { deletedAt: null } }),
      this.prisma.visit.count({
        where: { deletedAt: null, visitDate: { gte: monthStart } },
      }),
      this.latestHeartbeatPerTenant(heartbeatCutoff),
      this.prisma.telemetryAlert.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_ALERTS_LIMIT,
      }),
      this.health.probeDb(),
    ]);

    const byStatus = new Map(clinicCounts.map((g) => [g.status, g._count] as const));
    const totalTenants = (byStatus.get('active') ?? 0) + (byStatus.get('suspended') ?? 0);

    const dbWorst = latestHeartbeats.find((h) => !h.dbHealthy);
    const orthancWorst = latestHeartbeats.find((h) => !h.orthancHealthy);
    const diskWorst = latestHeartbeats.reduce<{ tenantId: string; percent: number } | null>(
      (acc, h) => {
        const pct = Number(h.diskPercent);
        if (!Number.isFinite(pct)) return acc;
        if (!acc || pct > acc.percent) return { tenantId: h.tenantId, percent: pct };
        return acc;
      },
      null,
    );
    const backupWorst = latestHeartbeats.reduce<{
      tenantId: string;
      hoursAgo: number;
    } | null>((acc, h) => {
      if (!h.lastBackupAt) return acc;
      const hoursAgo = (now.getTime() - h.lastBackupAt.getTime()) / 3_600_000;
      if (!acc || hoursAgo > acc.hoursAgo) return { tenantId: h.tenantId, hoursAgo };
      return acc;
    }, null);

    return {
      generatedAt: now.toISOString(),
      tenants: {
        total: totalTenants,
        active: byStatus.get('active') ?? 0,
        suspended: byStatus.get('suspended') ?? 0,
      },
      users: {
        total: userTotal,
        activeToday: activeUsers,
      },
      patients: {
        total: patientTotal,
        visitsThisMonth,
      },
      systems: [
        {
          key: 'database',
          label: 'Database',
          status: dbProbe.ok && !dbWorst ? 'ok' : 'critical',
          detail: dbProbe.ok
            ? dbWorst
              ? `${dbWorst.tenantId}: DB e paarritshme`
              : `I shëndetshëm · latencë ${dbProbe.latencyMs}ms`
            : 'DB e paarritshme në server',
          lastCheckedAt: now.toISOString(),
        },
        {
          key: 'backups',
          label: 'Backup-ot',
          status:
            backupWorst && backupWorst.hoursAgo > 30
              ? 'critical'
              : backupWorst && backupWorst.hoursAgo > 24
                ? 'warning'
                : 'ok',
          detail: backupWorst
            ? `Më i fundit: ~${backupWorst.hoursAgo.toFixed(0)} orë më parë (${backupWorst.tenantId})`
            : 'Asnjë informacion backup ende',
          lastCheckedAt: now.toISOString(),
        },
        {
          key: 'tunnels',
          label: 'Tunelet on-prem',
          status: 'ok',
          detail: `${latestHeartbeats.length} klinika me heartbeat të freskët`,
          lastCheckedAt: now.toISOString(),
        },
        {
          key: 'orthanc',
          label: 'Orthanc / DICOM',
          status: orthancWorst ? 'warning' : 'ok',
          detail: orthancWorst ? `${orthancWorst.tenantId}: Orthanc i paarritshëm` : 'Të gjithë në rregull',
          lastCheckedAt: now.toISOString(),
        },
        {
          key: 'storage',
          label: 'Hapësira në disk',
          status:
            diskWorst && diskWorst.percent >= 95
              ? 'critical'
              : diskWorst && diskWorst.percent >= 85
                ? 'warning'
                : 'ok',
          detail: diskWorst
            ? `Max: ${diskWorst.percent.toFixed(0)}% në ${diskWorst.tenantId}`
            : 'Pa heartbeat aktiv',
          lastCheckedAt: now.toISOString(),
        },
      ],
      recentAlerts: recentAlerts.map((a) => ({
        id: a.id,
        tenantId: a.tenantId,
        severity: a.severity,
        kind: a.kind,
        message: a.message,
        createdAt: a.createdAt.toISOString(),
        notifiedAt: a.notifiedAt?.toISOString() ?? null,
      })),
    };
  }

  /** One row per tenant_id, the latest heartbeat within the freshness window. */
  private async latestHeartbeatPerTenant(cutoff: Date): Promise<
    Array<{
      tenantId: string;
      receivedAt: Date;
      appHealthy: boolean;
      dbHealthy: boolean;
      orthancHealthy: boolean;
      diskPercent: number;
      lastBackupAt: Date | null;
    }>
  > {
    type Row = {
      tenant_id: string;
      received_at: Date;
      app_healthy: boolean;
      db_healthy: boolean;
      orthanc_healthy: boolean;
      disk_percent: number;
      last_backup_at: Date | null;
    };
    // The platform-admin dashboard needs the most recent heartbeat
    // per tenant. Prisma doesn't ergonomically express DISTINCT ON,
    // so this is the documented `prisma.$queryRaw` exception
    // (CLAUDE.md §6). The cutoff bounds the scan.
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT DISTINCT ON (tenant_id)
             tenant_id,
             received_at,
             app_healthy,
             db_healthy,
             orthanc_healthy,
             disk_percent::float AS disk_percent,
             last_backup_at
        FROM telemetry_heartbeats
       WHERE received_at >= ${cutoff}
    ORDER BY tenant_id, received_at DESC
    `;
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      receivedAt: r.received_at,
      appHealthy: r.app_healthy,
      dbHealthy: r.db_healthy,
      orthancHealthy: r.orthanc_healthy,
      diskPercent: r.disk_percent,
      lastBackupAt: r.last_backup_at,
    }));
  }
}
