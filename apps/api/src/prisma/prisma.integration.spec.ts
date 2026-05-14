// Integration test: seeded schema + Postgres Row-Level Security.
//
// Spins up the real Prisma client against a live Postgres (the one
// started by `make dev`). Skips automatically when `DATABASE_URL` is
// unset, so unit-test runs on a laptop without docker keep working.
//
// Pre-requisites (the test does NOT re-apply them, so a host without
// `psql` on PATH still works):
//   * `make db-migrate` — applies Prisma migrations + manual SQL
//     (RLS, indexes, triggers).
//   * `make db-seed` — populates DonetaMED clinic, users, ICD-10.
//
// Assertions:
//   1. The seed populated the four bootstrap tables.
//   2. RLS prevents cross-clinic reads: with `app.clinic_id` set to
//      clinic A, a query for clinic B's patients returns zero rows.
//   3. The soft-delete middleware filters `deleted_at IS NOT NULL` rows
//      even when the caller didn't ask.

import type { PinoLogger } from 'nestjs-pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaService } from './prisma.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const ENABLED = Boolean(DATABASE_URL);

function makeNoopLogger(): PinoLogger {
  return {
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    setContext: () => undefined,
    assign: () => undefined,
  } as unknown as PinoLogger;
}

describe.skipIf(!ENABLED)('Prisma + RLS integration', () => {
  let service: PrismaService;
  let donetamedClinicId: string;
  let otherClinicId: string;

  beforeAll(async () => {
    service = new PrismaService(makeNoopLogger());
    await service.onModuleInit();

    // Provision a second clinic so we have something to be denied
    // access to. RLS only blocks cross-clinic reads if there are two
    // clinics in the database.
    const second = await service.clinic.upsert({
      where: { subdomain: 'rlstest' },
      update: {},
      create: {
        subdomain: 'rlstest',
        name: 'RLS Test Clinic',
        shortName: 'RLSTest',
        address: 'n/a',
        city: 'n/a',
        phones: [],
        email: 'rlstest@example.com',
        hoursConfig: {},
        paymentCodes: {},
        logoUrl: '/assets/test/logo.png',
        signatureUrl: '/assets/test/sig.png',
        status: 'active',
      },
    });
    otherClinicId = second.id;

    const donetamed = await service.clinic.findUniqueOrThrow({
      where: { subdomain: 'donetamed' },
    });
    donetamedClinicId = donetamed.id;
  });

  afterAll(async () => {
    await service?.onModuleDestroy();
  });

  it('seeds the four bootstrap tables', async () => {
    const [clinics, users, admins, icd10] = await Promise.all([
      service.clinic.count(),
      service.user.count(),
      service.platformAdmin.count(),
      service.icd10Code.count(),
    ]);
    expect(clinics).toBeGreaterThanOrEqual(2);
    expect(users).toBeGreaterThanOrEqual(2);
    expect(admins).toBeGreaterThanOrEqual(1);
    expect(icd10).toBeGreaterThan(100);
  });

  it('RLS: in clinic A context, queries against clinic B return zero rows', async () => {
    // Establish a known patient in clinic B (rlstest). Outside any
    // tenant context, the application code uses the bypass path
    // (table owner is the dev superuser). The actual RLS gate is
    // demonstrated below via `SET LOCAL ROLE klinika_app`.
    await service.patient.create({
      data: {
        clinicId: otherClinicId,
        firstName: 'Should',
        lastName: 'NotLeak',
        dateOfBirth: new Date('2020-01-01'),
      },
    });

    // Demote into the non-superuser application role so RLS actually
    // fires. In production the connection IS klinika_app from the
    // start; in dev the connection is a superuser that bypasses RLS,
    // so we explicitly switch within the transaction. Both `SET LOCAL`
    // calls revert at COMMIT/ROLLBACK.
    const visibleFromDonetamed = await service.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE klinika_app');
      await tx.$executeRaw`SELECT set_config('app.clinic_id', ${donetamedClinicId}::text, true)`;
      return tx.patient.findMany();
    });

    // Inside the donetamed tenant context, the other clinic's patient
    // must be invisible. RLS is the enforcement layer; even a buggy
    // service that forgets `where: { clinicId }` cannot leak.
    const leaked = visibleFromDonetamed.filter(
      (p) => p.clinicId === otherClinicId,
    );
    expect(leaked).toHaveLength(0);
  });

  it('soft-delete middleware hides deleted_at IS NOT NULL rows', async () => {
    const created = await service.patient.create({
      data: {
        clinicId: donetamedClinicId,
        firstName: 'SoftDelete',
        lastName: 'Probe',
        dateOfBirth: new Date('2021-01-01'),
      },
    });

    await service.patient.update({
      where: { id: created.id },
      data: { deletedAt: new Date() },
    });

    const found = await service.patient.findUnique({ where: { id: created.id } });
    expect(found).toBeNull();
  });
});
