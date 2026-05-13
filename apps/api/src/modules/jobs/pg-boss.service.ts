import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';
import PgBoss from 'pg-boss';

/**
 * Thin wrapper around pg-boss exposing the small slice the rest of the
 * app needs:
 *
 *   - `schedule(name, cron, options)` — recurring jobs (telemetry uses
 *     this for the 60s collector and 90-day retention sweep).
 *   - `work(name, handler)` — register a handler for a job queue.
 *   - `send(name, payload)` — fire a one-off job (used by the alert
 *     engine for digest-vs-immediate dispatch).
 *
 * Started in `onApplicationBootstrap` (not `onModuleInit`) so it never
 * blocks Nest's HTTP listener if the DB is slow to come up: HTTP can
 * answer `/health` while pg-boss is still establishing its pool. The
 * service catches startup errors so a flaky job DB doesn't crash the
 * app — telemetry is best-effort by design (CLAUDE.md §3 jobs ADR-003).
 */
@Injectable()
export class PgBossService implements OnApplicationBootstrap, OnModuleDestroy {
  private boss: PgBoss | null = null;
  private started = false;

  constructor(
    @InjectPinoLogger(PgBossService.name)
    private readonly logger: PinoLogger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const url = process.env['DATABASE_URL'];
    if (!url) {
      this.logger.warn('DATABASE_URL not set; pg-boss will not start');
      return;
    }
    if (process.env['JOBS_DISABLED'] === '1') {
      this.logger.info('Background jobs disabled by JOBS_DISABLED=1');
      return;
    }

    const boss = new PgBoss({
      connectionString: url,
      // pg-boss installs into its own schema by default; keeping it
      // isolated from the app schema makes Prisma migrations trivial.
      schema: 'pgboss',
      // Application-level retries — telemetry tolerates loss, so we
      // don't want a stuck job to pile up.
      retryLimit: 3,
      retryDelay: 60,
    });

    boss.on('error', (err) => {
      this.logger.error({ err }, 'pg-boss runtime error');
    });

    try {
      await boss.start();
      this.boss = boss;
      this.started = true;
      this.logger.info('pg-boss started');
    } catch (err) {
      this.logger.error({ err }, 'pg-boss failed to start');
      // Swallow — telemetry will silently no-op until the next boot.
      // The frontend's connection status + the platform's tenant-
      // offline detector both notice eventually.
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss && this.started) {
      try {
        await this.boss.stop({ graceful: true, timeout: 5_000 });
      } catch (err) {
        this.logger.warn({ err }, 'pg-boss stop error');
      }
    }
  }

  isReady(): boolean {
    return this.started && this.boss !== null;
  }

  async schedule(
    name: string,
    cron: string,
    options: PgBoss.ScheduleOptions = {},
  ): Promise<void> {
    if (!this.boss) {
      return;
    }
    await this.boss.schedule(name, cron, undefined, options);
  }

  async work<T extends object = object>(
    name: string,
    handler: (job: PgBoss.Job<T>) => Promise<void>,
  ): Promise<void> {
    if (!this.boss) {
      return;
    }
    await this.boss.work<T>(name, async (jobs) => {
      // pg-boss v10 dispatches arrays of jobs; we process them one at a
      // time. Failures throw — pg-boss handles retry/backoff itself.
      for (const job of jobs) {
        await handler(job);
      }
    });
  }

  async send<T extends object>(name: string, payload: T): Promise<string | null> {
    if (!this.boss) {
      return null;
    }
    return this.boss.send(name, payload);
  }

  async queueSize(name: string): Promise<number> {
    if (!this.boss) {
      return 0;
    }
    try {
      return await this.boss.getQueueSize(name);
    } catch {
      return 0;
    }
  }
}
