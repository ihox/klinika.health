// Integration test: full receiver path including auth and persistence.
//
// Skips if DATABASE_URL is unset — same convention as the Prisma
// integration test. Asserts:
//   - Bearer auth is enforced (401 on missing/wrong secret).
//   - A valid heartbeat is persisted with the metadata fields.
//   - PHI-shaped fields slipped into the payload are stripped on the
//     way into `telemetry_heartbeats.payload`.
//   - Alert rows are created when the heartbeat trips a rule.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertEngineService } from './alert-engine.service';
import { HeartbeatReceiverController } from './heartbeat-receiver.controller';

const DATABASE_URL = process.env['DATABASE_URL'];
const ENABLED = Boolean(DATABASE_URL);

describe.skipIf(!ENABLED)('Heartbeat receiver — integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const apiDir = resolve(__dirname, '..', '..', '..');
    execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, stdio: 'inherit' });

    process.env['TELEMETRY_TENANT_SECRETS'] = JSON.stringify({
      donetamed: 'shh-1234567890',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [LoggerModule.forRoot({ pinoHttp: { level: 'silent' } }), PrismaModule],
      controllers: [HeartbeatReceiverController],
      providers: [AlertEngineService],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      tenantId: 'donetamed',
      version: '0.0.1',
      emittedAt: new Date().toISOString(),
      appHealthy: true,
      dbHealthy: true,
      orthancHealthy: true,
      cpuPercent: 10,
      ramPercent: 20,
      diskPercent: 30,
      lastBackupAt: new Date().toISOString(),
      activeSessions: 0,
      queueDepth: 0,
      errorRate5xx: 0,
      ...overrides,
    };
  }

  it('returns 401 without a bearer token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/telemetry/heartbeat')
      .send(payload());
    expect(res.status).toBe(401);
  });

  it('returns 401 with the wrong bearer token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/telemetry/heartbeat')
      .set('authorization', 'Bearer wrong')
      .send(payload());
    expect(res.status).toBe(401);
  });

  it('persists a valid heartbeat and returns 202', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/telemetry/heartbeat')
      .set('authorization', 'Bearer shh-1234567890')
      .send(payload({ tenantId: 'donetamed', cpuPercent: 23.4 }));
    expect(res.status).toBe(202);

    const rows = await prisma.telemetryHeartbeat.findMany({
      where: { tenantId: 'donetamed' },
      orderBy: { receivedAt: 'desc' },
      take: 1,
    });
    expect(rows[0]).toBeDefined();
    expect(rows[0]?.cpuPercent.toString()).toMatch(/^23\.4/);
    expect(rows[0]?.appHealthy).toBe(true);
  });

  it('strips PHI-shaped keys from the persisted payload JSONB', async () => {
    await request(app.getHttpServer())
      .post('/api/telemetry/heartbeat')
      .set('authorization', 'Bearer shh-1234567890')
      .send(
        payload({
          tenantId: 'donetamed',
          firstName: 'PoisonAttempt',
          lastName: 'X',
          diagnosis: 'J06.9',
          extraMetadata: { ok: true },
        }),
      );

    const row = await prisma.telemetryHeartbeat.findFirst({
      where: { tenantId: 'donetamed' },
      orderBy: { receivedAt: 'desc' },
    });
    const payloadJson = row?.payload as Record<string, unknown>;
    expect(payloadJson).toBeDefined();
    expect(payloadJson.firstName).toBeUndefined();
    expect(payloadJson.lastName).toBeUndefined();
    expect(payloadJson.diagnosis).toBeUndefined();
    expect(payloadJson.extraMetadata).toEqual({ ok: true });
  });

  it('creates an alert row when a heartbeat reports critical disk', async () => {
    await request(app.getHttpServer())
      .post('/api/telemetry/heartbeat')
      .set('authorization', 'Bearer shh-1234567890')
      .send(payload({ tenantId: 'donetamed', diskPercent: 97.5 }));

    // Alert evaluation is fire-and-forget — give it a moment.
    await new Promise((r) => setTimeout(r, 250));

    const alerts = await prisma.telemetryAlert.findMany({
      where: { tenantId: 'donetamed', kind: 'disk_critical' },
    });
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]?.severity).toBe('critical');
  });
});
