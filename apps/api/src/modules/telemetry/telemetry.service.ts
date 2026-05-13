import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { PgBossService } from '../jobs/pg-boss.service';
import { AlertEngineService } from './alert-engine.service';
import { HeartbeatSenderService } from './heartbeat-sender.service';
import { TelemetryCollectorService } from './telemetry-collector.service';

export const TELEMETRY_HEARTBEAT_JOB = 'telemetry.heartbeat';
export const TELEMETRY_OFFLINE_SWEEP_JOB = 'telemetry.offline-sweep';
export const TELEMETRY_RETENTION_JOB = 'telemetry.retention';
export const TELEMETRY_RETENTION_DAYS = 90;

/**
 * Orchestrates the three scheduled jobs that make up the telemetry
 * subsystem:
 *
 *   1. `telemetry.heartbeat` — every 60s, collects local metrics and
 *      POSTs them to the platform.
 *   2. `telemetry.offline-sweep` — every 60s on the platform side,
 *      detects tenants that haven't checked in for >5 minutes.
 *   3. `telemetry.retention` — daily at 03:30, prunes heartbeats older
 *      than 90 days.
 *
 * All three are pg-boss scheduled jobs (ADR-003). The cadence is
 * driven by cron expressions, not in-process timers, so a restart
 * doesn't reset the schedule and multiple replicas don't double up.
 *
 * The agent runs on **every** install — cloud-hosted clinics, the
 * platform tenant itself, and on-premise. The receiver only runs on
 * the platform side; tenants don't reach each other. To distinguish:
 * `TELEMETRY_ROLE` is `agent` (default) or `platform`. The platform
 * role registers the offline-sweep + retention jobs in addition to
 * the heartbeat job.
 */
@Injectable()
export class TelemetryService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  constructor(
    private readonly boss: PgBossService,
    private readonly collector: TelemetryCollectorService,
    private readonly sender: HeartbeatSenderService,
    private readonly alerts: AlertEngineService,
    private readonly prisma: PrismaService,
    @InjectPinoLogger(TelemetryService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.boss.isReady()) {
      this.logger.warn(
        'pg-boss not ready; telemetry will not register schedules. The agent will start at next boot.',
      );
      return;
    }

    await this.registerHeartbeatJob();

    const role = process.env['TELEMETRY_ROLE'] ?? 'agent';
    if (role === 'platform') {
      await this.registerPlatformJobs();
    }
  }

  async onModuleDestroy(): Promise<void> {
    // pg-boss handles draining; we don't unschedule on shutdown because
    // schedules outlive process lifecycles by design (cron pattern).
  }

  /**
   * Run one heartbeat cycle directly — bypassing pg-boss. Used by tests
   * and by an admin "test telemetry" CLI command.
   */
  async runHeartbeatNow(): Promise<void> {
    try {
      const payload = await this.collector.collect();
      const outcome = await this.sender.send(payload);
      if (!outcome.ok) {
        this.logger.warn(
          { reason: outcome.reason, tenantId: payload.tenantId },
          'Heartbeat dispatch failed; logged but not retried inline',
        );
      }
    } catch (err) {
      // Telemetry must never crash the host process.
      this.logger.error({ err }, 'Heartbeat collection failed');
    }
  }

  /**
   * Run one offline-sweep + retention cycle. Used by tests.
   */
  async runPlatformSweepNow(now: Date = new Date()): Promise<void> {
    await this.alerts.detectOfflineTenants(now);
    await this.purgeOldHeartbeats(now);
  }

  private async registerHeartbeatJob(): Promise<void> {
    await this.boss.work(TELEMETRY_HEARTBEAT_JOB, async () => {
      await this.runHeartbeatNow();
    });
    // Every minute, all environments.
    await this.boss.schedule(TELEMETRY_HEARTBEAT_JOB, '* * * * *');
    this.logger.info('Telemetry heartbeat scheduled (every minute)');
  }

  private async registerPlatformJobs(): Promise<void> {
    await this.boss.work(TELEMETRY_OFFLINE_SWEEP_JOB, async () => {
      try {
        await this.alerts.detectOfflineTenants();
      } catch (err) {
        this.logger.error({ err }, 'Offline-sweep job failed');
      }
    });
    await this.boss.schedule(TELEMETRY_OFFLINE_SWEEP_JOB, '* * * * *');

    await this.boss.work(TELEMETRY_RETENTION_JOB, async () => {
      try {
        await this.purgeOldHeartbeats(new Date());
      } catch (err) {
        this.logger.error({ err }, 'Retention job failed');
      }
    });
    // 03:30 daily — quiet time at the clinic.
    await this.boss.schedule(TELEMETRY_RETENTION_JOB, '30 3 * * *');

    this.logger.info('Platform telemetry jobs scheduled');
  }

  private async purgeOldHeartbeats(now: Date): Promise<number> {
    const cutoff = new Date(
      now.getTime() - TELEMETRY_RETENTION_DAYS * 24 * 3_600_000,
    );
    const { count } = await this.prisma.telemetryHeartbeat.deleteMany({
      where: { receivedAt: { lt: cutoff } },
    });
    if (count > 0) {
      this.logger.info({ count, cutoff }, 'Telemetry heartbeats purged');
    }
    return count;
  }
}
