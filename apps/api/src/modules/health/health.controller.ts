import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';

import {
  HealthService,
  type DeepHealthSnapshot,
  type SchemaProbeResult,
} from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /**
   * Liveness — returns 200 if the process is alive. Cheap; no DB query.
   * Used by container orchestration and the frontend connection
   * indicator. Polled every ~30 seconds, so kept stable and small.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<{ status: 'ok' }> {
    await this.health.liveness();
    return { status: 'ok' };
  }

  /**
   * Readiness — 200 only when the DB is reachable. 503 otherwise so a
   * load balancer can drain this instance during a Postgres outage.
   */
  @Get('ready')
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' | 'degraded'; db: { ok: boolean; latencyMs: number } }> {
    const { ok, db } = await this.health.readiness();
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: ok ? 'ok' : 'degraded',
      db: { ok: db.ok, latencyMs: db.latencyMs },
    };
  }

  /**
   * Schema drift check. 200 if all probes pass, 503 if any column the
   * Prisma client expects is missing from the live DB. The response
   * lists every probe so the failing one is obvious. See
   * {@link HealthService.probeSchema} for the rationale.
   */
  @Get('schema')
  async schema(
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' | 'drift' } & SchemaProbeResult> {
    const result = await this.health.probeSchema();
    res.status(result.ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: result.ok ? 'ok' : 'drift',
      ...result,
    };
  }

  /**
   * Deep health — DB latency, Orthanc reachability, host metrics.
   * **Not for public exposure.** In production Caddy is configured to
   * 403 this path from the public internet (only the local telemetry
   * agent and authenticated platform admins reach it). The endpoint
   * itself returns the full snapshot regardless; the gate is at the
   * network edge.
   */
  @Get('deep')
  async deep(): Promise<DeepHealthSnapshot> {
    return this.health.deep();
  }
}
