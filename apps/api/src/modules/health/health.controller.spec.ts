import { describe, expect, it, vi } from 'vitest';

import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

function makeService(overrides: Partial<HealthService> = {}): HealthService {
  return {
    liveness: vi.fn().mockResolvedValue({ ok: true }),
    readiness: vi
      .fn()
      .mockResolvedValue({ ok: true, db: { ok: true, latencyMs: 3 } }),
    deep: vi.fn().mockResolvedValue({
      app: { ok: true, version: '0.0.0-dev', uptimeSeconds: 1 },
      db: { ok: true, latencyMs: 3 },
      orthanc: { ok: true, latencyMs: 0, status: 0 },
      system: {
        cpuPercent: 1,
        ramPercent: 2,
        diskPercent: 3,
        loadAverage1m: 0,
        uptimeSeconds: 4,
      },
      timestamp: '2026-05-13T12:00:00.000Z',
    }),
    ...overrides,
  } as unknown as HealthService;
}

interface FakeResponse {
  statusCode?: number;
  status: (n: number) => FakeResponse;
}

function makeRes(): FakeResponse {
  const res: FakeResponse = {
    status(code: number) {
      this.statusCode = code;
      return this;
    },
  };
  return res;
}

describe('HealthController', () => {
  it('GET /health returns { status: ok }', async () => {
    const controller = new HealthController(makeService());
    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 when DB is healthy', async () => {
    const controller = new HealthController(makeService());
    const res = makeRes();
    const body = await controller.ready(res as never);
    expect(res.statusCode).toBe(200);
    expect(body).toEqual({ status: 'ok', db: { ok: true, latencyMs: 3 } });
  });

  it('GET /health/ready returns 503 when DB probe fails', async () => {
    const controller = new HealthController(
      makeService({
        readiness: vi.fn().mockResolvedValue({
          ok: false,
          db: { ok: false, latencyMs: 0, error: 'db_unreachable' },
        }),
      }),
    );
    const res = makeRes();
    const body = await controller.ready(res as never);
    expect(res.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
  });

  it('GET /health/deep returns the full snapshot', async () => {
    const controller = new HealthController(makeService());
    const snapshot = await controller.deep();
    expect(snapshot.app.ok).toBe(true);
    expect(snapshot.system.cpuPercent).toBe(1);
    expect(snapshot.db.ok).toBe(true);
  });
});
