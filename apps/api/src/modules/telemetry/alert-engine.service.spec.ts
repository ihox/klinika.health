import type { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../prisma/prisma.service';
import { AlertEngineService } from './alert-engine.service';
import type { HeartbeatPayload } from './telemetry.types';

function makeLogger(): PinoLogger {
  return {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    setContext: vi.fn(),
    assign: vi.fn(),
  } as unknown as PinoLogger;
}

function basePayload(overrides: Partial<HeartbeatPayload> = {}): HeartbeatPayload {
  return {
    tenantId: 'donetamed',
    version: '0.0.0',
    emittedAt: '2026-05-13T12:00:00.000Z',
    appHealthy: true,
    dbHealthy: true,
    orthancHealthy: true,
    cpuPercent: 10,
    ramPercent: 20,
    diskPercent: 40,
    lastBackupAt: '2026-05-13T03:00:00.000Z',
    activeSessions: 0,
    queueDepth: 0,
    errorRate5xx: 0,
    ...overrides,
  };
}

describe('AlertEngineService.derive', () => {
  let engine: AlertEngineService;

  beforeEach(() => {
    const prisma = {} as unknown as PrismaService;
    engine = new AlertEngineService(prisma, makeLogger());
  });

  const now = new Date('2026-05-13T12:00:00.000Z');

  it('returns no alerts for a healthy heartbeat', () => {
    const alerts = engine.derive('donetamed', basePayload(), now);
    expect(alerts).toEqual([]);
  });

  it('raises a critical disk alert at >=95%', () => {
    const alerts = engine.derive(
      'donetamed',
      basePayload({ diskPercent: 96 }),
      now,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.severity).toBe('critical');
    expect(alerts[0]?.kind).toBe('disk_critical');
  });

  it('raises a warning at >=85% but below 95%', () => {
    const alerts = engine.derive(
      'donetamed',
      basePayload({ diskPercent: 90 }),
      now,
    );
    expect(alerts[0]?.severity).toBe('warning');
    expect(alerts[0]?.kind).toBe('disk_warning');
  });

  it('raises a db_down critical when dbHealthy=false', () => {
    const alerts = engine.derive(
      'donetamed',
      basePayload({ dbHealthy: false }),
      now,
    );
    expect(alerts.find((a) => a.kind === 'db_down')?.severity).toBe('critical');
  });

  it('raises orthanc_down only as a warning', () => {
    const alerts = engine.derive(
      'donetamed',
      basePayload({ orthancHealthy: false }),
      now,
    );
    expect(alerts.find((a) => a.kind === 'orthanc_down')?.severity).toBe(
      'warning',
    );
  });

  it('raises backup_failed when last backup is >30h old', () => {
    const oldBackup = new Date(now.getTime() - 36 * 3_600_000);
    const alerts = engine.derive(
      'donetamed',
      basePayload({ lastBackupAt: oldBackup.toISOString() }),
      now,
    );
    expect(alerts.find((a) => a.kind === 'backup_failed')?.severity).toBe(
      'critical',
    );
  });

  it('dedupeKey is stable across same-day disk_critical events', () => {
    const a = engine.derive('donetamed', basePayload({ diskPercent: 99 }), now);
    const b = engine.derive(
      'donetamed',
      basePayload({ diskPercent: 97 }),
      new Date(now.getTime() + 60_000),
    );
    expect(a[0]?.dedupeKey).toBe(b[0]?.dedupeKey);
  });
});

describe('AlertEngineService.persist + grouping', () => {
  it('downgrades per-tenant offline alerts to warning when 3+ are offline', async () => {
    const calls: Array<{ where: { dedupeKey: string } }> = [];
    const created: Array<Record<string, unknown>> = [];
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        { tenant_id: 'a', latest: new Date() },
        { tenant_id: 'b', latest: new Date() },
        { tenant_id: 'c', latest: new Date() },
      ]),
      telemetryAlert: {
        findFirst: vi.fn((args: { where: { dedupeKey: string } }) => {
          calls.push(args);
          return Promise.resolve(null);
        }),
        create: vi.fn((args: { data: Record<string, unknown> }) => {
          created.push(args.data);
          return Promise.resolve({ id: 'x', ...args.data });
        }),
      },
    } as unknown as PrismaService;

    const engine = new AlertEngineService(prisma, makeLogger());
    const out = await engine.detectOfflineTenants(
      new Date('2026-05-13T12:00:00.000Z'),
    );

    // 3 per-tenant alerts (now downgraded) + 1 platform-wide critical = 4.
    expect(out).toHaveLength(4);
    const perTenant = out.filter((a) => a.tenantId !== 'platform');
    const platform = out.find((a) => a.tenantId === 'platform');
    expect(perTenant.every((a) => a.severity === 'warning')).toBe(true);
    expect(platform?.severity).toBe('critical');
    expect(platform?.message).toContain('Multi-tenant outage');
  });
});
