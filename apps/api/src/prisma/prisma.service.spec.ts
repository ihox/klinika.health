import type { Prisma } from '@prisma/client';
import type { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from './prisma.service';

// Build a fake PinoLogger with vitest spies — enough surface to satisfy
// the injection and let us assert that .warn was called with the right
// shape.
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
    logger: undefined,
  } as unknown as PinoLogger;
}

// Helper: build a Prisma middleware `params` object with sensible
// defaults. The `as never` casts only narrow `action` and `model` to the
// nominal Prisma types — runtime behaviour is unaffected.
function makeParams(
  overrides: Partial<Prisma.MiddlewareParams> = {},
): Prisma.MiddlewareParams {
  return {
    model: 'Patient',
    action: 'findMany',
    args: {},
    dataPath: [],
    runInTransaction: false,
    ...overrides,
  } as Prisma.MiddlewareParams;
}

describe('PrismaService.softDeleteMiddleware', () => {
  let service: PrismaService;

  beforeEach(() => {
    service = new PrismaService(makeLogger());
  });

  it('adds deletedAt:null to findMany on a soft-delete-tracked model', async () => {
    const next = vi.fn().mockResolvedValue([]);
    const params = makeParams({ model: 'Patient', action: 'findMany', args: {} });

    await service.softDeleteMiddleware(params, next);

    expect(next).toHaveBeenCalledTimes(1);
    const calledWith = next.mock.calls[0][0] as Prisma.MiddlewareParams;
    expect(calledWith.args).toEqual({
      where: { AND: [{}, { deletedAt: null }] },
    });
  });

  it('preserves the caller-supplied where alongside the soft-delete clause', async () => {
    const next = vi.fn().mockResolvedValue([]);
    const callerWhere = { clinicId: 'abc-123' };
    const params = makeParams({
      model: 'Visit',
      action: 'findMany',
      args: { where: callerWhere },
    });

    await service.softDeleteMiddleware(params, next);

    const calledWith = next.mock.calls[0][0] as Prisma.MiddlewareParams;
    expect(calledWith.args).toEqual({
      where: { AND: [callerWhere, { deletedAt: null }] },
    });
  });

  it('applies on findFirst, count, aggregate, and groupBy via AND wrap', async () => {
    const actions: Prisma.PrismaAction[] = [
      'findFirst',
      'findFirstOrThrow',
      'count',
      'aggregate',
      'groupBy',
    ];

    for (const action of actions) {
      const next = vi.fn().mockResolvedValue(null);
      const params = makeParams({ model: 'Clinic', action, args: {} });
      await service.softDeleteMiddleware(params, next);
      const calledWith = next.mock.calls[0][0] as Prisma.MiddlewareParams;
      expect(
        (calledWith.args as { where?: unknown }).where,
        `${action} should be filtered`,
      ).toEqual({ AND: [{}, { deletedAt: null }] });
    }
  });

  it('spreads deletedAt:null at top level for findUnique (preserves unique-key validation)', async () => {
    for (const action of ['findUnique', 'findUniqueOrThrow'] as const) {
      const next = vi.fn().mockResolvedValue(null);
      const params = makeParams({
        model: 'Clinic',
        action,
        args: { where: { subdomain: 'donetamed' } },
      });
      await service.softDeleteMiddleware(params, next);
      const calledWith = next.mock.calls[0][0] as Prisma.MiddlewareParams;
      // The unique key must remain at the top level; AND-wrapping would
      // hide it from Prisma's WhereUniqueInput validation.
      expect(calledWith.args).toEqual({
        where: { subdomain: 'donetamed', deletedAt: null },
      });
    }
  });

  it('does NOT touch write actions (create/update/upsert/delete)', async () => {
    const writeActions: Prisma.PrismaAction[] = [
      'create',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
    ];

    for (const action of writeActions) {
      const next = vi.fn().mockResolvedValue({});
      const originalArgs = { data: { firstName: 'X' } };
      const params = makeParams({
        model: 'Patient',
        action,
        args: { ...originalArgs },
      });

      await service.softDeleteMiddleware(params, next);

      const calledWith = next.mock.calls[0][0] as Prisma.MiddlewareParams;
      expect(calledWith.args, `${action} args should be untouched`).toEqual(
        originalArgs,
      );
    }
  });

  it('does NOT touch reads on models without deleted_at (ICD-10, audit log)', async () => {
    const nonSoftDeleteModels: Prisma.ModelName[] = [
      'Icd10Code',
      'AuditLog',
      'PlatformAdmin',
      'VisitDiagnosis',
      'PrescriptionLine',
    ];

    for (const model of nonSoftDeleteModels) {
      const next = vi.fn().mockResolvedValue([]);
      const params = makeParams({ model, action: 'findMany', args: {} });
      await service.softDeleteMiddleware(params, next);
      const calledWith = next.mock.calls[0][0] as Prisma.MiddlewareParams;
      expect(calledWith.args, `${model} args should be untouched`).toEqual({});
    }
  });

  it('handles missing model (raw queries) without throwing', async () => {
    const next = vi.fn().mockResolvedValue([]);
    const params = {
      action: 'queryRaw',
      args: ['SELECT 1'],
      dataPath: [],
      runInTransaction: false,
    } as unknown as Prisma.MiddlewareParams;

    await expect(service.softDeleteMiddleware(params, next)).resolves.toEqual(
      [],
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('PrismaService.handleQueryEvent (slow-query logging)', () => {
  let logger: PinoLogger;
  let service: PrismaService;

  beforeEach(() => {
    logger = makeLogger();
    service = new PrismaService(logger);
  });

  it('logs a warning when duration exceeds the threshold', () => {
    service.handleQueryEvent({
      timestamp: new Date(),
      query: 'SELECT * FROM "patients" WHERE "clinic_id" = $1',
      params: '["00000000-0000-0000-0000-000000000001"]',
      duration: 1500,
      target: 'quaint::connector::metrics',
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [meta, msg] = (logger.warn as ReturnType<typeof vi.fn>).mock
      .calls[0] as [Record<string, unknown>, string];
    expect(msg).toBe('Slow Prisma query');
    expect(meta).toMatchObject({
      durationMs: 1500,
      sql: 'SELECT * FROM "patients" WHERE "clinic_id" = $1',
    });
  });

  it('does NOT log when duration is below threshold', () => {
    service.handleQueryEvent({
      timestamp: new Date(),
      query: 'SELECT 1',
      params: '[]',
      duration: 5,
      target: 'quaint::connector::metrics',
    });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('never includes query parameters in the log payload (PHI safety)', () => {
    service.handleQueryEvent({
      timestamp: new Date(),
      query: 'UPDATE "visits" SET "diagnosis" = $1 WHERE "id" = $2',
      params: '["confidential diagnosis text","abc-uuid"]',
      duration: 9999,
      target: 'quaint::connector::metrics',
    });

    const [meta] = (logger.warn as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Record<string, unknown>,
      string,
    ];
    const serialised = JSON.stringify(meta);
    expect(serialised).not.toContain('confidential diagnosis text');
    expect(serialised).not.toContain('params');
  });
});
