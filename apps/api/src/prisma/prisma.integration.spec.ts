// Integration test: seeded schema + Postgres Row-Level Security.
//
// Spins up the real Prisma client against a live Postgres (the one
// started by `make dev`). Skips automatically when `DATABASE_URL` is
// unset, so unit-test runs on a laptop without docker keep working.
//
// Assertions:
//   1. The seed script populates clinics, users, patients, ICD-10
//      codes — the four tables the API depends on at boot.
//   2. RLS prevents cross-clinic reads: with `app.clinic_id` set to
//      clinic A, a query for clinic B's patients returns zero rows.
//   3. The soft-delete middleware filters `deleted_at IS NOT NULL` rows
//      even when the caller didn't ask.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

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
    // Apply migrations + run the seed. `prisma migrate deploy` is
    // idempotent (only runs pending migrations); the seed is upsert-
    // based and also idempotent. The manual SQL (RLS, indexes,
    // triggers) is layered after Prisma's auto-generated migration.
    const apiDir = resolve(__dirname, '..', '..');
    execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, stdio: 'inherit' });
    execSync(
      `psql "${DATABASE_URL ?? ''}" -v ON_ERROR_STOP=1 -f prisma/migrations/manual/001_rls_indexes_triggers.sql`,
      { cwd: apiDir, stdio: 'inherit' },
    );
    execSync('pnpm seed', { cwd: apiDir, stdio: 'inherit' });

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
    // (table owner). The actual RLS gate is in `runInTenantContext`.
    await service.patient.create({
      data: {
        clinicId: otherClinicId,
        firstName: 'Should',
        lastName: 'NotLeak',
        dateOfBirth: new Date('2020-01-01'),
      },
    });

    const visibleFromDonetamed = await service.runInTenantContext(
      donetamedClinicId,
      async (tx) => tx.patient.findMany(),
    );

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
