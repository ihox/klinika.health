import {
  Injectable,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

// Models whose reads should be filtered to `deleted_at IS NULL` by
// default. Listed explicitly because Prisma middleware fires for every
// model, and `icd10_codes`, `audit_log`, etc. have no `deleted_at`
// column.
const SOFT_DELETE_MODELS = new Set<string>([
  'Clinic',
  'User',
  'Patient',
  'Visit',
  'Appointment',
]);

const SOFT_DELETE_READ_ACTIONS = new Set<Prisma.PrismaAction>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const DEFAULT_SLOW_QUERY_MS = 500;

// Captured as `const` so its type can be threaded through
// `PrismaClient<...>` and `$on('query', ...)` resolves to the correct
// `Prisma.QueryEvent` overload at compile time.
const PRISMA_LOG_CONFIG = [
  { emit: 'event', level: 'query' },
  { emit: 'stdout', level: 'warn' },
  { emit: 'stdout', level: 'error' },
] as const satisfies Prisma.PrismaClientOptions['log'];

/**
 * Wraps {@link PrismaClient} with the three middlewares Klinika requires
 * on every request:
 *
 *   1. Soft-delete: reads on `Clinic`, `User`, `Patient`, `Visit`, and
 *      `Appointment` automatically gain `WHERE deleted_at IS NULL`
 *      (ADR-008).
 *   2. RLS tenant context: {@link runInTenantContext} opens a transaction
 *      and `SET LOCAL`s `app.clinic_id`, so the Postgres RLS policies
 *      installed by `migrations/manual/001_rls_indexes_triggers.sql`
 *      scope every query to the caller's clinic (ADR-005).
 *   3. Slow-query logging: queries slower than `PRISMA_SLOW_QUERY_MS`
 *      (default 500ms) emit a Pino warn with the parameterised SQL
 *      skeleton and duration only — never the parameters, which may
 *      contain PHI (CLAUDE.md §1.3, §7).
 */
@Injectable()
export class PrismaService
  extends PrismaClient<{ log: typeof PRISMA_LOG_CONFIG }>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly slowQueryThresholdMs: number;

  constructor(
    @InjectPinoLogger(PrismaService.name)
    private readonly logger: PinoLogger,
  ) {
    super({ log: PRISMA_LOG_CONFIG });
    const raw = process.env['PRISMA_SLOW_QUERY_MS'];
    const parsed = raw ? Number(raw) : DEFAULT_SLOW_QUERY_MS;
    this.slowQueryThresholdMs =
      Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SLOW_QUERY_MS;
  }

  async onModuleInit(): Promise<void> {
    this.$on('query', (event: Prisma.QueryEvent) => {
      this.handleQueryEvent(event);
    });
    this.$use(this.softDeleteMiddleware);
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `work` inside a Postgres transaction with `app.clinic_id` set
   * to {@link clinicId}. RLS policies on every tenant-scoped table use
   * this setting to enforce isolation. `set_config(..., true)` makes
   * the setting transaction-local, so it clears automatically at
   * COMMIT or ROLLBACK.
   *
   * The {@link work} callback receives a Prisma `TransactionClient`
   * bound to the same connection; queries issued through it are
   * scoped, queries issued through `this` (outside the callback) are
   * not.
   */
  runInTenantContext<T>(
    clinicId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.clinic_id', ${clinicId}::text, true)`;
      return work(tx);
    });
  }

  // Exposed for unit tests — the middleware function is otherwise
  // private. Tests invoke it directly with a stubbed `next` to verify
  // the where-clause rewrite without spinning up Postgres.
  public readonly softDeleteMiddleware: Prisma.Middleware = async (
    params,
    next,
  ) => {
    const model = params.model;
    if (
      model &&
      SOFT_DELETE_MODELS.has(model) &&
      SOFT_DELETE_READ_ACTIONS.has(params.action)
    ) {
      const args = (params.args ?? {}) as { where?: unknown };
      const existing = args.where ?? {};
      params.args = { ...args, where: { AND: [existing, { deletedAt: null }] } };
    }
    return next(params);
  };

  // Exposed for unit tests.
  public handleQueryEvent(event: Prisma.QueryEvent): void {
    if (event.duration < this.slowQueryThresholdMs) {
      return;
    }
    this.logger.warn(
      {
        durationMs: event.duration,
        // `event.query` is the parameterised SQL skeleton (e.g.
        // `SELECT ... WHERE "clinic_id" = $1`). Parameters live in
        // `event.params` and are deliberately NOT logged — they may
        // contain PHI (patient names, diagnoses, notes).
        sql: event.query,
        target: event.target,
      },
      'Slow Prisma query',
    );
  }
}
