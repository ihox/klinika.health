import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import type { HeartbeatPayload } from './telemetry.types';

export type SendOutcome =
  | { ok: true; status: number }
  | { ok: false; reason: 'no_url' | 'network' | 'http'; status?: number };

/**
 * POSTs heartbeats to the platform. Network failures are logged but do
 * NOT throw — the telemetry sweep must never fail loudly (CLAUDE.md §3
 * jobs ADR-003: telemetry is best-effort).
 *
 * - `TELEMETRY_HEARTBEAT_URL` is the endpoint (default
 *   `https://klinika.health/api/telemetry/heartbeat`).
 * - `TELEMETRY_SHARED_SECRET` is the per-tenant bearer token; the
 *   platform side issues one secret per tenant at onboarding.
 * - `TELEMETRY_DISABLED=1` short-circuits the sender (used by local dev
 *   and tests so they don't fire real HTTP).
 */
@Injectable()
export class HeartbeatSenderService {
  constructor(
    @InjectPinoLogger(HeartbeatSenderService.name)
    private readonly logger: PinoLogger,
  ) {}

  async send(payload: HeartbeatPayload): Promise<SendOutcome> {
    if (process.env['TELEMETRY_DISABLED'] === '1') {
      return { ok: true, status: 0 };
    }
    const url =
      process.env['TELEMETRY_HEARTBEAT_URL'] ??
      'https://klinika.health/api/telemetry/heartbeat';
    const secret = process.env['TELEMETRY_SHARED_SECRET'];
    if (!url) {
      return { ok: false, reason: 'no_url' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(secret ? { authorization: `Bearer ${secret}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          { status: res.status, tenantId: payload.tenantId },
          'Heartbeat POST returned non-2xx',
        );
        return { ok: false, reason: 'http', status: res.status };
      }
      return { ok: true, status: res.status };
    } catch (err) {
      this.logger.warn(
        { err, tenantId: payload.tenantId },
        'Heartbeat POST failed',
      );
      return { ok: false, reason: 'network' };
    } finally {
      clearTimeout(timeout);
    }
  }
}
