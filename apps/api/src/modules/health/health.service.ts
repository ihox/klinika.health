import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { sampleSystemMetrics } from '../telemetry/system-metrics';

export interface DbProbeResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export interface OrthancProbeResult {
  ok: boolean;
  latencyMs: number;
  status?: number;
  error?: string;
}

export interface DeepHealthSnapshot {
  app: { ok: true; version: string; uptimeSeconds: number };
  db: DbProbeResult;
  orthanc: OrthancProbeResult;
  system: Awaited<ReturnType<typeof sampleSystemMetrics>>;
  timestamp: string;
}

const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(HealthService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Cheap liveness probe. Returns true as long as the process is alive
   * — meaning the HTTP server is accepting connections. Used by Caddy /
   * the container orchestrator for restart decisions.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async liveness(): Promise<{ ok: true }> {
    return { ok: true };
  }

  /**
   * Readiness probe. Returns ok only when the database is reachable.
   * Useful for the load balancer to take an instance out of rotation
   * during DB outages without killing the process.
   */
  async readiness(): Promise<{ ok: boolean; db: DbProbeResult }> {
    const db = await this.probeDb();
    return { ok: db.ok, db };
  }

  /**
   * Deep health. Used by the telemetry agent (and by `/health/deep` for
   * platform operators). Returns DB latency, Orthanc reachability, and
   * host metrics. Never exposed to the public internet — gated by
   * platform-admin auth in a later slice.
   */
  async deep(): Promise<DeepHealthSnapshot> {
    const [db, orthanc, system] = await Promise.all([
      this.probeDb(),
      this.probeOrthanc(),
      sampleSystemMetrics(),
    ]);
    return {
      app: {
        ok: true,
        version: process.env['APP_VERSION'] ?? '0.0.0-dev',
        uptimeSeconds: Math.floor(process.uptime()),
      },
      db,
      orthanc,
      system,
      timestamp: new Date().toISOString(),
    };
  }

  async probeDb(): Promise<DbProbeResult> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      // Never include `err.message` verbatim — Prisma sometimes echoes
      // the failing SQL. Log the full error structurally so operators
      // can see it; expose only a short reason in the response.
      this.logger.warn({ err }, 'DB readiness probe failed');
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: 'db_unreachable',
      };
    }
  }

  async probeOrthanc(): Promise<OrthancProbeResult> {
    const baseUrl = process.env['ORTHANC_URL'];
    if (!baseUrl) {
      // Orthanc is optional on cloud-only installs; absence is not a
      // failure. Mark probe as ok so the health snapshot doesn't trip
      // alarms on environments that don't run DICOM.
      return { ok: true, latencyMs: 0, status: 0 };
    }

    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DEFAULT_PROBE_TIMEOUT_MS,
    );
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/system`, {
        method: 'GET',
        signal: controller.signal,
        headers: this.orthancAuthHeader(),
      });
      return {
        ok: res.ok,
        latencyMs: Date.now() - started,
        status: res.status,
      };
    } catch (err) {
      this.logger.warn({ err }, 'Orthanc readiness probe failed');
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: 'orthanc_unreachable',
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private orthancAuthHeader(): Record<string, string> {
    const user = process.env['ORTHANC_USERNAME'];
    const pass = process.env['ORTHANC_PASSWORD'];
    if (!user || !pass) {
      return {};
    }
    const token = Buffer.from(`${user}:${pass}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }
}
