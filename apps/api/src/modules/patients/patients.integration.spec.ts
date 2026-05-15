// Integration tests for the patients API surface.
//
// Mirrors the auth/admin/settings integration pattern (real Postgres,
// real Nest app, supertest at the HTTP layer). Covers:
//
//   1. Receptionist search returns only the public DTO fields
//   2. Receptionist 403s on GET/PATCH/DELETE :id
//   3. Receptionist POST silently drops extra fields
//   4. Doctor sees full data on search + get
//   5. Doctor full create round-trips all fields
//   6. PATCH updates emit audit log diffs
//   7. Soft delete + restore round-trip
//   8. Fuzzy search: "Hoxa" matches "Hoxha"; "çekaj" matches "Cekaj"
//   9. Cross-clinic RLS isolation
//
// Skips automatically when DATABASE_URL or seed passwords are unset.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { CapturingEmailSender, EMAIL_SENDER, EmailService } from '../email/email.service';
import { SESSION_COOKIE_NAME } from '../auth/session.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_RECEPTIONIST_PASSWORD = process.env['SEED_RECEPTIONIST_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_RECEPTIONIST_PASSWORD);

const TENANT_HOST = 'donetamed.klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';
const RECEPTIONIST_EMAIL = 'ereblire.krasniqi@klinika.health';

const RECEPTIONIST_PUBLIC_KEYS = ['id', 'firstName', 'lastName', 'dateOfBirth'].sort();

describe.skipIf(!ENABLED)('Patients integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let clinicId: string;
  let secondClinicId: string;

  beforeAll(async () => {
    const apiDir = resolve(__dirname, '..', '..', '..');
    execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, stdio: 'inherit' });
    for (const f of [
      '001_rls_indexes_triggers.sql',
      '002_auth_rls.sql',
      '003_admin.sql',
      '004_patients_search.sql',
    ]) {
      execSync(
        `psql "${DATABASE_URL ?? ''}" -v ON_ERROR_STOP=1 -f prisma/sql/${f}`,
        { cwd: apiDir, stdio: 'inherit' },
      );
    }
    execSync('pnpm seed', { cwd: apiDir, stdio: 'inherit' });

    captured = new CapturingEmailSender();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(captured)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { limit: '6mb' });
    app.set('trust proxy', true);
    await app.init();
    prisma = app.get(PrismaService);
    app.get(EmailService).setSender(captured);

    const clinic = await prisma.clinic.findFirstOrThrow({ where: { subdomain: 'donetamed' } });
    clinicId = clinic.id;

    // Provision a second clinic for cross-tenant RLS testing.
    const second = await prisma.clinic.upsert({
      where: { subdomain: 'second-test' },
      update: {},
      create: {
        subdomain: 'second-test',
        name: 'Klinika Tjetër',
        shortName: 'Tjetër',
        address: 'rr. Test',
        city: 'Prishtinë',
        phones: ['044 11 22 33'],
        email: 'info@second.test',
        hoursConfig: {
          timezone: 'Europe/Belgrade',
          days: {
            mon: { open: true, start: '10:00', end: '18:00' },
            tue: { open: true, start: '10:00', end: '18:00' },
            wed: { open: true, start: '10:00', end: '18:00' },
            thu: { open: true, start: '10:00', end: '18:00' },
            fri: { open: true, start: '10:00', end: '18:00' },
            sat: { open: false },
            sun: { open: false },
          },
          durations: [10, 15, 20, 30],
          defaultDuration: 15,
        },
        paymentCodes: { E: { label: 'Falas', amountCents: 0 } },
        logoUrl: '',
        signatureUrl: '',
      },
    });
    secondClinicId = second.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    captured.clear();
    await prisma.rateLimit.deleteMany({});
    await prisma.authLoginAttempt.deleteMany({});
    await prisma.authMfaCode.deleteMany({});
    await prisma.authTrustedDevice.deleteMany({});
    await prisma.authSession.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { clinicId } });
    // Clinical FKs ahead of patients so the test-only `deleteMany`
    // below doesn't trip NoAction constraints from the chart tests.
    await prisma.vertetim.deleteMany({ where: { clinicId } });
    await prisma.visitDicomLink.deleteMany({});
    await prisma.visitDiagnosis.deleteMany({});
    await prisma.visit.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId: secondClinicId } });

    // Seed deterministic patients for search tests.
    await prisma.patient.createMany({
      data: [
        {
          clinicId,
          firstName: 'Rita',
          lastName: 'Hoxha',
          dateOfBirth: new Date('2024-02-12'),
          phone: '+383 44 111 222',
        },
        {
          clinicId,
          firstName: 'Rita',
          lastName: 'Hoxhaj',
          dateOfBirth: new Date('2024-02-15'),
          alergjiTjera: 'Penicilinë',
        },
        {
          clinicId,
          firstName: 'Era',
          lastName: 'Krasniqi',
          dateOfBirth: new Date('2023-08-03'),
          placeOfBirth: 'Prizren',
          sex: 'f',
        },
        {
          clinicId,
          firstName: 'Çelë',
          lastName: 'Cekaj',
          dateOfBirth: new Date('2022-04-01'),
        },
        {
          clinicId,
          firstName: 'Dion',
          lastName: 'Hoxha',
          dateOfBirth: new Date('2019-01-15'),
          legacyId: 4829,
        },
      ],
    });

    // A patient in the second clinic, used to verify RLS.
    await prisma.patient.create({
      data: {
        clinicId: secondClinicId,
        firstName: 'Secret',
        lastName: 'CrossClinic',
        dateOfBirth: new Date('2020-01-01'),
      },
    });
  });

  // ----------------------------------------------------------------------
  // Receptionist surface
  // ----------------------------------------------------------------------

  describe('receptionist', () => {
    it('search returns only id, firstName, lastName, dateOfBirth', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get('/api/patients?q=Rita')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.patients.length).toBeGreaterThanOrEqual(2);
      for (const p of res.body.patients) {
        expect(Object.keys(p).sort()).toEqual(RECEPTIONIST_PUBLIC_KEYS);
      }
    });

    it('search "Hoxa" matches the surname "Hoxha" (trigram)', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get('/api/patients?q=Hoxa')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const names = (res.body.patients as Array<{ lastName: string }>).map((p) => p.lastName);
      expect(names).toContain('Hoxha');
    });

    it('search "Cekaj" matches "Çelë Cekaj" via diacritic-insensitive unaccent', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get('/api/patients?q=Cele')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const names = (res.body.patients as Array<{ firstName: string }>).map((p) => p.firstName);
      expect(names).toContain('Çelë');
    });

    it('combined "Hoxha 2024" filters by name + year', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get('/api/patients?q=' + encodeURIComponent('Hoxha 2024'))
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const dobs = (res.body.patients as Array<{ dateOfBirth: string | null }>).map(
        (p) => p.dateOfBirth?.slice(0, 4) ?? '',
      );
      // Top hits should include 2024 birthdays.
      expect(dobs).toContain('2024');
    });

    it('GET /:id returns 403', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId } });
      const res = await req()
        .get(`/api/patients/${patient.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });

    it('PATCH /:id returns 403', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId } });
      const res = await req()
        .patch(`/api/patients/${patient.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ alergjiTjera: 'leak attempt' });
      expect(res.status).toBe(403);
    });

    it('POST with firstName only succeeds (lastName optional)', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .post('/api/patients')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ firstName: 'Bardhi' });
      expect(res.status).toBe(201);
      expect(Object.keys(res.body.patient).sort()).toEqual(RECEPTIONIST_PUBLIC_KEYS);
      expect(res.body.patient.firstName).toBe('Bardhi');
      expect(res.body.patient.lastName).toBe('');
      expect(res.body.patient.dateOfBirth).toBeNull();
    });

    it('POST with extra fields silently drops them (not stored)', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .post('/api/patients')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({
          firstName: 'Test',
          lastName: 'Recept',
          dateOfBirth: '2024-05-01',
          // These fields must reach the DB as nulls — Zod silently
          // strips them, and the service writes only the three
          // permitted columns regardless.
          phone: '+383 44 999 888',
          alergjiTjera: 'sneak',
          birthWeightG: 3500,
          placeOfBirth: 'attempt',
        });
      expect(res.status).toBe(201);
      // Response is PatientPublicDto — exactly four keys.
      expect(Object.keys(res.body.patient).sort()).toEqual(RECEPTIONIST_PUBLIC_KEYS);
      // Row in DB has nulls for every forbidden field.
      const row = await prisma.patient.findFirstOrThrow({
        where: { clinicId, firstName: 'Test', lastName: 'Recept' },
      });
      expect(row.phone).toBeNull();
      expect(row.alergjiTjera).toBeNull();
      expect(row.birthWeightG).toBeNull();
      expect(row.placeOfBirth).toBeNull();
    });

    it('duplicate-check surfaces likely candidates (informational only)', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .post('/api/patients/duplicate-check')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ firstName: 'Rita', lastName: 'Hoxha', dateOfBirth: '2024-02-12' });
      expect(res.status).toBe(200);
      expect(res.body.candidates.length).toBeGreaterThanOrEqual(1);
      // Public DTO shape only.
      for (const c of res.body.candidates) {
        expect(Object.keys(c).sort()).toEqual(RECEPTIONIST_PUBLIC_KEYS);
      }
    });
  });

  // ----------------------------------------------------------------------
  // Doctor surface
  // ----------------------------------------------------------------------

  describe('doctor', () => {
    it('search returns full DTO fields', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get('/api/patients?q=Era')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const era = (res.body.patients as Array<Record<string, unknown>>).find(
        (p) => p['firstName'] === 'Era',
      );
      expect(era).toBeDefined();
      expect(era).toMatchObject({
        firstName: 'Era',
        lastName: 'Krasniqi',
        placeOfBirth: 'Prizren',
        sex: 'f',
      });
    });

    it('GET /:id returns full record', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const era = await prisma.patient.findFirstOrThrow({
        where: { clinicId, firstName: 'Era' },
      });
      const res = await req()
        .get(`/api/patients/${era.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.patient.placeOfBirth).toBe('Prizren');
      expect(res.body.patient.sex).toBe('f');
    });

    it('POST creates a full record with master data', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .post('/api/patients')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({
          firstName: 'Lori',
          lastName: 'Gashi',
          dateOfBirth: '2021-06-12',
          sex: 'f',
          placeOfBirth: 'Pejë',
          phone: '+383 44 444 555',
          birthWeightG: 3450,
          birthLengthCm: 50,
          birthHeadCircumferenceCm: 34,
          alergjiTjera: 'Pa alergji të njohura',
        });
      expect(res.status).toBe(201);
      expect(res.body.patient).toMatchObject({
        firstName: 'Lori',
        lastName: 'Gashi',
        sex: 'f',
        placeOfBirth: 'Pejë',
        birthWeightG: 3450,
        alergjiTjera: 'Pa alergji të njohura',
        isComplete: true,
      });
    });

    it('GET /:id returns isComplete=false for a receptionist-created patient', async () => {
      // Seed a minimal patient as the receptionist would — only
      // firstName + lastName, no sex, sentinel DOB. Then read it as
      // the doctor and verify isComplete=false.
      const minimal = await prisma.patient.create({
        data: {
          clinicId,
          firstName: 'Minimal',
          lastName: '',
          dateOfBirth: new Date('1900-01-01T00:00:00Z'),
        },
      });
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get(`/api/patients/${minimal.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.patient.isComplete).toBe(false);
      expect(res.body.patient.dateOfBirth).toBeNull();
      expect(res.body.patient.lastName).toBe('');
      expect(res.body.patient.sex).toBeNull();
    });

    it('PATCH updates and emits an audit log', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const era = await prisma.patient.findFirstOrThrow({
        where: { clinicId, firstName: 'Era' },
      });
      const res = await req()
        .patch(`/api/patients/${era.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ phone: '+383 49 100 200', alergjiTjera: 'Penicilinë' });
      expect(res.status).toBe(200);
      expect(res.body.patient.phone).toBe('+383 49 100 200');
      expect(res.body.patient.alergjiTjera).toBe('Penicilinë');

      const audits = await prisma.auditLog.findMany({
        where: { clinicId, resourceId: era.id, action: 'patient.updated' },
      });
      expect(audits.length).toBe(1);
      const changes = (audits[0]?.changes ?? []) as Array<{ field: string }>;
      expect(changes.map((c) => c.field).sort()).toEqual(['alergjiTjera', 'phone']);
    });

    it('DELETE soft-deletes and POST /:id/restore brings it back', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const dion = await prisma.patient.findFirstOrThrow({
        where: { clinicId, firstName: 'Dion' },
      });

      const del = await req()
        .delete(`/api/patients/${dion.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(del.status).toBe(200);
      const after = await prisma.patient.findUniqueOrThrow({ where: { id: dion.id } });
      expect(after.deletedAt).not.toBeNull();

      const restore = await req()
        .post(`/api/patients/${dion.id}/restore`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(restore.status).toBe(200);
      const reloaded = await prisma.patient.findUniqueOrThrow({ where: { id: dion.id } });
      expect(reloaded.deletedAt).toBeNull();
    });

    it('restore on a patient that was never deleted returns 404', async () => {
      // The 30-second undo window (ADR-008) is client-side only — the
      // server has no time-window check, so the only failure mode for
      // restore is "row not soft-deleted." If the row was never deleted,
      // findFirst with deletedAt: { not: null } matches nothing → 404.
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const target = await prisma.patient.findFirstOrThrow({
        where: { clinicId, deletedAt: null },
      });

      const restore = await req()
        .post(`/api/patients/${target.id}/restore`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(restore.status).toBe(404);
    });
  });

  // ----------------------------------------------------------------------
  // Chart bundle (master + visits + vërtetime)
  // ----------------------------------------------------------------------

  describe('chart bundle', () => {
    it('receptionist GET :id/chart returns 403', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const patient = await prisma.patient.findFirstOrThrow({ where: { clinicId } });
      const res = await req()
        .get(`/api/patients/${patient.id}/chart`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });

    it('doctor GET :id/chart returns patient + visits + vërtetime', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const era = await prisma.patient.findFirstOrThrow({
        where: { clinicId, firstName: 'Era' },
      });
      const doctor = await prisma.user.findFirstOrThrow({
        where: { clinicId, email: DOCTOR_EMAIL },
      });

      // Seed three visits in deterministic order — most recent first
      // after the chart sorts by visitDate DESC.
      const visitA = await prisma.visit.create({
        data: {
          clinicId,
          patientId: era.id,
          visitDate: new Date('2026-04-01'),
          createdBy: doctor.id,
          updatedBy: doctor.id,
          paymentCode: 'A',
          legacyDiagnosis: 'Tonsillitis',
        },
      });
      const visitB = await prisma.visit.create({
        data: {
          clinicId,
          patientId: era.id,
          visitDate: new Date('2026-02-22'),
          createdBy: doctor.id,
          updatedBy: doctor.id,
          paymentCode: 'B',
        },
      });
      const visitC = await prisma.visit.create({
        data: {
          clinicId,
          patientId: era.id,
          visitDate: new Date('2025-12-17'),
          createdBy: doctor.id,
          updatedBy: doctor.id,
          paymentCode: 'A',
        },
      });

      // A vërtetim attached to the most-recent visit.
      await prisma.vertetim.create({
        data: {
          clinicId,
          patientId: era.id,
          visitId: visitA.id,
          issuedBy: doctor.id,
          issuedAt: new Date('2026-04-01T10:30:00Z'),
          absenceFrom: new Date('2026-04-01'),
          absenceTo: new Date('2026-04-05'),
          diagnosisSnapshot: 'J03.9 Tonsillitis acuta',
        },
      });

      const res = await req()
        .get(`/api/patients/${era.id}/chart`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const body = res.body as {
        patient: { firstName: string; sex: string | null };
        visits: Array<{ id: string; visitDate: string; paymentCode: string | null }>;
        vertetime: Array<{ id: string; durationDays: number }>;
        daysSinceLastVisit: number | null;
        visitCount: number;
      };
      expect(body.patient.firstName).toBe('Era');
      expect(body.patient.sex).toBe('f');
      expect(body.visits.map((v) => v.id)).toEqual([
        visitA.id,
        visitB.id,
        visitC.id,
      ]);
      expect(body.visits.map((v) => v.paymentCode)).toEqual(['A', 'B', 'A']);
      expect(body.visitCount).toBe(3);
      expect(body.daysSinceLastVisit).toBeGreaterThanOrEqual(0);
      expect(body.vertetime).toHaveLength(1);
      expect(body.vertetime[0]).toMatchObject({
        durationDays: 5,
        diagnosisSnapshot: 'J03.9 Tonsillitis acuta',
      });

      // Audit row recorded for the sensitive read.
      const audits = await prisma.auditLog.findMany({
        where: {
          clinicId,
          resourceId: era.id,
          action: 'patient.chart.viewed',
        },
      });
      expect(audits.length).toBeGreaterThanOrEqual(1);
      expect(audits[0]?.changes).toBeNull();
    });

    it('doctor GET :id/chart 404s on unknown patient', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get(`/api/patients/00000000-0000-0000-0000-000000000000/chart`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
    });

    // Translation-layer invariant (companion to the appointments
    // module's invariant in appointments.integration.spec.ts). After
    // the visits-merge (ADR-011) scheduled appointments live in the
    // same `visits` table as completed clinical visits. The chart's
    // history list must only show rows the doctor has touched —
    // i.e. `status IN ('completed', 'in_progress')`. Scheduled /
    // arrived / no_show / cancelled rows are receptionist-controlled
    // lifecycle states and stay out of the clinical timeline.
    it('chart history excludes scheduled appointments (status != completed/in_progress)', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const era = await prisma.patient.findFirstOrThrow({
        where: { clinicId, firstName: 'Era' },
      });
      const doctor = await prisma.user.findFirstOrThrow({
        where: { clinicId, email: DOCTOR_EMAIL },
      });
      const receptionist = await prisma.user.findFirstOrThrow({
        where: { clinicId, email: RECEPTIONIST_EMAIL },
      });

      // 1 completed clinical visit (the doctor has touched it).
      const completed = await prisma.visit.create({
        data: {
          clinicId,
          patientId: era.id,
          visitDate: new Date('2026-04-10'),
          status: 'completed',
          paymentCode: 'A',
          complaint: 'Test complaint',
          createdBy: doctor.id,
          updatedBy: doctor.id,
        },
      });

      // 1 scheduled appointment (still in the receptionist's
      // calendar). Must NOT appear in the chart's history list.
      const scheduledFor = new Date('2026-05-20T08:00:00Z');
      const scheduled = await prisma.visit.create({
        data: {
          clinicId,
          patientId: era.id,
          visitDate: new Date('2026-05-20'),
          scheduledFor,
          durationMinutes: 15,
          status: 'scheduled',
          createdBy: receptionist.id,
          updatedBy: receptionist.id,
        },
      });

      const res = await req()
        .get(`/api/patients/${era.id}/chart`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const ids = (res.body.visits as Array<{ id: string }>).map((v) => v.id);
      expect(ids).toContain(completed.id);
      expect(ids).not.toContain(scheduled.id);
      expect(res.body.visitCount).toBe(1);
    });

    it('doctor GET :id/chart on a patient without visits returns empty arrays', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const dion = await prisma.patient.findFirstOrThrow({
        where: { clinicId, firstName: 'Dion' },
      });
      const res = await req()
        .get(`/api/patients/${dion.id}/chart`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.visits).toEqual([]);
      expect(res.body.vertetime).toEqual([]);
      expect(res.body.visitCount).toBe(0);
      expect(res.body.daysSinceLastVisit).toBeNull();
    });
  });

  // ----------------------------------------------------------------------
  // Multi-tenant isolation (RLS belt + service-layer braces)
  // ----------------------------------------------------------------------

  describe('multi-tenant', () => {
    it('doctor in clinic A cannot search the cross-clinic patient', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get('/api/patients?q=CrossClinic')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const leaked = (res.body.patients as Array<{ lastName: string }>).find(
        (p) => p.lastName === 'CrossClinic',
      );
      expect(leaked).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------------

  function req(): request.Agent {
    return request(app.getHttpServer());
  }

  async function loginAs(email: string, password: string): Promise<string> {
    const start = await req()
      .post('/api/auth/login')
      .set('host', TENANT_HOST)
      .send({ email, password, rememberMe: false });
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('mfa_required');
    const pending = start.body.pendingSessionId as string;
    const msg = captured.takeLatest(email);
    expect(msg).toBeDefined();
    const match = msg!.text.match(/(\d{3}) (\d{3})/);
    const code = match ? `${match[1]}${match[2]}` : '';
    const verify = await req()
      .post('/api/auth/mfa/verify')
      .set('host', TENANT_HOST)
      .send({ pendingSessionId: pending, code, trustDevice: false });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie as string];
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    expect(session).toBeDefined();
    captured.clear();
    return session!.split(';')[0];
  }
});
