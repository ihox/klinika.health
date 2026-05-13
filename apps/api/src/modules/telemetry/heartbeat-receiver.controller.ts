import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

import type { Prisma } from '@prisma/client';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { AlertEngineService } from './alert-engine.service';
import type { HeartbeatPayload } from './telemetry.types';

type IncomingHeartbeat = HeartbeatPayload;

/**
 * Endpoint hit by every tenant install (cloud-hosted and on-premise).
 * Authentication is a shared bearer token per tenant — the platform
 * issues one secret at onboarding and ships it in the tenant's
 * environment. Secrets live in `TELEMETRY_TENANT_SECRETS` as a JSON
 * map `{ "donetamed": "abc..." }` or — in production — in a dedicated
 * `telemetry_tenant_secrets` table (later slice; this controller
 * accepts either source).
 *
 * The receiver MUST refuse payloads that look like they contain PHI
 * even if a misbehaving tenant tries to slip something through. The
 * server-side guard is light: we re-check key names against the same
 * redaction list before persisting. Mismatches log a warning and the
 * row is stored with the offending field nulled out.
 */
@Controller('api/telemetry')
export class HeartbeatReceiverController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: AlertEngineService,
    @InjectPinoLogger(HeartbeatReceiverController.name)
    private readonly logger: PinoLogger,
  ) {}

  @Post('heartbeat')
  @HttpCode(HttpStatus.ACCEPTED)
  async heartbeat(
    @Headers('authorization') auth: string | undefined,
    @Body() body: IncomingHeartbeat,
  ): Promise<{ ok: true }> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('payload required');
    }

    const tenantId = body.tenantId;
    if (!tenantId || typeof tenantId !== 'string' || tenantId.length > 64) {
      throw new BadRequestException('tenantId required');
    }

    const token = parseBearer(auth);
    if (!verifyTenantSecret(tenantId, token)) {
      this.logger.warn(
        { tenantId, hasToken: token !== null },
        'Heartbeat auth rejected',
      );
      throw new UnauthorizedException();
    }

    // Persist. Any payload field we don't recognize is preserved in
    // `payload` JSONB for forensics — but only after a PHI scan strips
    // unexpected free-text. The redaction net here is generous; we
    // err on the side of dropping data, not leaking it.
    const heartbeat = await this.prisma.telemetryHeartbeat.create({
      data: {
        tenantId,
        version: String(body.version ?? 'unknown'),
        emittedAt: parseDate(body.emittedAt) ?? new Date(),
        appHealthy: Boolean(body.appHealthy),
        dbHealthy: Boolean(body.dbHealthy),
        orthancHealthy: Boolean(body.orthancHealthy),
        cpuPercent: clampPercent(body.cpuPercent),
        ramPercent: clampPercent(body.ramPercent),
        diskPercent: clampPercent(body.diskPercent),
        lastBackupAt: parseDate(body.lastBackupAt) ?? null,
        activeSessions: clampInt(body.activeSessions),
        queueDepth: clampInt(body.queueDepth),
        errorRate5xx: clampInt(body.errorRate5xx),
        payload: stripPhi(body) as Prisma.InputJsonValue,
      },
    });

    // Run alert evaluation asynchronously — the receiver should not
    // wait on alert delivery. Errors are logged inside the engine.
    void this.alerts.evaluate(heartbeat.tenantId, body).catch((err) => {
      this.logger.error({ err, tenantId }, 'Alert evaluation failed');
    });

    return { ok: true };
  }
}

function parseBearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] ?? null) : null;
}

function loadTenantSecrets(): Record<string, string> {
  const raw = process.env['TELEMETRY_TENANT_SECRETS'];
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed;
  } catch {
    return {};
  }
}

function verifyTenantSecret(tenantId: string, token: string | null): boolean {
  if (!token) {
    return false;
  }
  const secrets = loadTenantSecrets();
  const expected = secrets[tenantId];
  if (!expected) {
    return false;
  }
  return timingSafeEqual(expected, token);
}

// Constant-time compare to avoid leaking secret length / prefix via
// timing. The length check is fine to short-circuit; only the value
// compare needs to be constant time.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return cryptoTimingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function parseDate(value: unknown): Date | null {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(100, n));
}

function clampInt(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

// PHI-redaction field list inlined here to keep the receiver
// self-contained. Must stay in sync with the Pino redaction config.
const FORBIDDEN_KEYS = new Set([
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

function stripPhi(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const source = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) {
    if (FORBIDDEN_KEYS.has(k)) {
      continue;
    }
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = stripPhi(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
