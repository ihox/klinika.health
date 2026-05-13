import type { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HealthService } from '../health/health.service';
import type { PgBossService } from '../jobs/pg-boss.service';
import { ErrorRateCounter } from './error-counter';
import { TelemetryCollectorService } from './telemetry-collector.service';

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

const PHI_FIELD_NAMES = new Set([
  'firstName',
  'lastName',
  'dateOfBirth',
  'placeOfBirth',
  'diagnosis',
  'prescription',
  'notes',
  'complaint',
  'alergjiTjera',
  'examinations',
  'ultrasoundNotes',
  'labResults',
  'followupNotes',
  'otherNotes',
  'phone',
  'email',
  'address',
  'diagnosisSnapshot',
]);

function assertNoPhi(obj: unknown, path = ''): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (PHI_FIELD_NAMES.has(k)) {
        throw new Error(`PHI key "${k}" found at ${path || '<root>'}`);
      }
      assertNoPhi(v, `${path}.${k}`);
    }
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoPhi(item, `${path}[${i}]`));
  }
}

describe('TelemetryCollectorService', () => {
  let svc: TelemetryCollectorService;
  let counter: ErrorRateCounter;

  beforeEach(() => {
    counter = new ErrorRateCounter();
    const health = {
      deep: vi.fn().mockResolvedValue({
        app: { ok: true, version: '0.0.0-dev', uptimeSeconds: 42 },
        db: { ok: true, latencyMs: 7 },
        orthanc: { ok: true, latencyMs: 12, status: 200 },
        system: {
          cpuPercent: 14.5,
          ramPercent: 36.2,
          diskPercent: 71.0,
          loadAverage1m: 0.3,
          uptimeSeconds: 3600,
        },
        timestamp: '2026-05-13T12:00:00.000Z',
      }),
    } as unknown as HealthService;
    const boss = {
      queueSize: vi.fn().mockResolvedValue(2),
    } as unknown as PgBossService;
    svc = new TelemetryCollectorService(health, boss, counter, makeLogger());
  });

  it('builds a payload with no PHI keys', async () => {
    process.env['KLINIKA_TENANT_ID'] = 'donetamed';
    const payload = await svc.collect();
    expect(() => assertNoPhi(payload)).not.toThrow();
    expect(payload.tenantId).toBe('donetamed');
    expect(payload.version).toBe('0.0.0-dev');
    expect(payload.cpuPercent).toBe(14.5);
    expect(payload.ramPercent).toBe(36.2);
    expect(payload.diskPercent).toBe(71.0);
    expect(payload.queueDepth).toBe(2);
    expect(payload.dbHealthy).toBe(true);
    expect(payload.orthancHealthy).toBe(true);
    expect(payload.appHealthy).toBe(true);
  });

  it('includes error rate from the counter and resets', async () => {
    counter.increment();
    counter.increment();
    counter.increment();
    const payload = await svc.collect();
    expect(payload.errorRate5xx).toBe(3);
    // Drained: a fresh collect should report 0.
    const next = await svc.collect();
    expect(next.errorRate5xx).toBe(0);
  });

  it('parses BACKUP_LAST_SUCCESS_AT when set', async () => {
    process.env['BACKUP_LAST_SUCCESS_AT'] = '2026-05-13T03:00:00Z';
    const payload = await svc.collect();
    expect(payload.lastBackupAt).toBe('2026-05-13T03:00:00.000Z');
    delete process.env['BACKUP_LAST_SUCCESS_AT'];
  });

  it('returns null lastBackupAt when env var is missing', async () => {
    delete process.env['BACKUP_LAST_SUCCESS_AT'];
    const payload = await svc.collect();
    expect(payload.lastBackupAt).toBeNull();
  });
});
