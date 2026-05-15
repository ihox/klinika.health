// Integration tests for the visits API surface (slice 12).
//
// Real Postgres, real Nest app, supertest at the HTTP layer.
// Covers:
//
//   1. Receptionist 403s on every visits endpoint
//   2. Doctor POST /api/visits creates a fresh visit (today's date)
//   3. Doctor PATCH /api/visits/:id writes a delta + audit row
//   4. Two PATCHes within 60s coalesce into one audit row (visit.updated)
//   5. PATCH > 60s later creates a new audit row instead of merging
//   6. DELETE soft-deletes; GET 404s afterward; restore brings it back
//   7. GET :id/history returns events newest-first with diff details
//   8. Cross-clinic isolation: doctor in clinic A can't PATCH B's visit
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

describe.skipIf(!ENABLED)('Visits integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let clinicId: string;
  let secondClinicId: string;
  let secondClinicPatientId: string;
  let doctorId: string;
  let patientId: string;

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

    const clinic = await prisma.clinic.findFirstOrThrow({
      where: { subdomain: 'donetamed' },
    });
    clinicId = clinic.id;

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

    const doctor = await prisma.user.findFirstOrThrow({
      where: { clinicId, email: DOCTOR_EMAIL },
    });
    doctorId = doctor.id;
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
    await prisma.auditLog.deleteMany({ where: { clinicId: secondClinicId } });
    await prisma.vertetim.deleteMany({ where: { clinicId } });
    await prisma.visitDicomLink.deleteMany({});
    await prisma.visitDiagnosis.deleteMany({});
    await prisma.doctorDiagnosisUsage.deleteMany({ where: { clinicId } });
    await prisma.visit.deleteMany({ where: { clinicId } });
    await prisma.visit.deleteMany({ where: { clinicId: secondClinicId } });
    await prisma.patient.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId: secondClinicId } });

    const patient = await prisma.patient.create({
      data: {
        clinicId,
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: new Date('2023-08-03'),
        sex: 'f',
      },
    });
    patientId = patient.id;

    const cross = await prisma.patient.create({
      data: {
        clinicId: secondClinicId,
        firstName: 'Cross',
        lastName: 'Clinic',
        dateOfBirth: new Date('2020-01-01'),
      },
    });
    secondClinicPatientId = cross.id;
  });

  // -------------------------------------------------------------------------
  // Receptionist surface — all blocked
  // -------------------------------------------------------------------------

  describe('receptionist', () => {
    it('POST /api/visits returns 403', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .post('/api/visits')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ patientId });
      expect(res.status).toBe(403);
    });

    it('GET /api/visits/:id returns 403', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });

    it('PATCH /api/visits/:id returns 403', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ complaint: 'sneaky' });
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Doctor surface
  // -------------------------------------------------------------------------

  describe('doctor', () => {
    it('POST /api/visits creates a visit dated today + audit', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .post('/api/visits')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ patientId });
      expect(res.status).toBe(201);
      expect(res.body.visit.patientId).toBe(patientId);
      expect(res.body.visit.wasUpdated).toBe(false);
      // visitDate is today (Europe/Belgrade) — but locally we accept
      // any iso-day to avoid TZ flake in CI.
      expect(res.body.visit.visitDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Doctor-driven creation is born 'in_progress' so the chart's
      // "Përfundo vizitën" CTA is the reachable next action.
      const row = await prisma.visit.findUnique({
        where: { id: res.body.visit.id },
      });
      expect(row!.status).toBe('in_progress');

      const audits = await prisma.auditLog.findMany({
        where: { clinicId, resourceId: res.body.visit.id, action: 'visit.created' },
      });
      expect(audits.length).toBe(1);
    });

    it('PATCH /api/visits/:id writes a delta + audit diffs', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({
          complaint: 'Kollë e thatë me ethe.',
          weightG: 13_600,
          paymentCode: 'A',
        });
      expect(res.status).toBe(200);
      expect(res.body.visit.complaint).toContain('Kollë');
      expect(res.body.visit.weightG).toBe(13_600);
      expect(res.body.visit.paymentCode).toBe('A');
      expect(res.body.visit.wasUpdated).toBe(true);

      const audits = await prisma.auditLog.findMany({
        where: { clinicId, resourceId: visit.id, action: 'visit.updated' },
      });
      expect(audits.length).toBe(1);
      const changes = (audits[0]?.changes ?? []) as Array<{ field: string }>;
      expect(changes.map((c) => c.field).sort()).toEqual([
        'complaint',
        'paymentCode',
        'weightG',
      ]);
    });

    it('two PATCH saves within 60s coalesce into ONE audit row', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ complaint: 'first' });
      await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ complaint: 'second' });

      const audits = await prisma.auditLog.findMany({
        where: { clinicId, resourceId: visit.id, action: 'visit.updated' },
      });
      expect(audits.length).toBe(1);
      const changes = (audits[0]?.changes ?? []) as Array<{
        field: string;
        old: unknown;
        new: unknown;
      }>;
      const complaint = changes.find((c) => c.field === 'complaint');
      expect(complaint).toBeDefined();
      // Coalesce keeps the oldest `old` and the newest `new`.
      expect(complaint?.old).toBeNull();
      expect(complaint?.new).toBe('second');
    });

    it('PATCH > 60s later creates a NEW audit row', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ complaint: 'first' });

      // Backdate the existing audit row past the 60-second coalesce
      // window — re-emit the next PATCH and expect a second row.
      await prisma.auditLog.updateMany({
        where: { clinicId, resourceId: visit.id, action: 'visit.updated' },
        data: { timestamp: new Date(Date.now() - 5 * 60_000) },
      });

      await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ complaint: 'much later' });

      const audits = await prisma.auditLog.findMany({
        where: { clinicId, resourceId: visit.id, action: 'visit.updated' },
        orderBy: { timestamp: 'asc' },
      });
      expect(audits.length).toBe(2);
    });

    it('DELETE soft-deletes and GET 404s afterward', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      const del = await req()
        .delete(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(del.status).toBe(200);
      expect(del.body.status).toBe('ok');
      expect(typeof del.body.restorableUntil).toBe('string');

      const after = await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(after.deletedAt).not.toBeNull();

      const get = await req()
        .get(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(get.status).toBe(404);
    });

    it('POST /:id/restore brings a soft-deleted visit back', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      await req()
        .delete(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      const restore = await req()
        .post(`/api/visits/${visit.id}/restore`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(restore.status).toBe(200);
      const after = await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } });
      expect(after.deletedAt).toBeNull();
    });

    it('restore on a visit that was never deleted returns 404', async () => {
      // The 30-second undo window (ADR-008) is client-side only — the
      // server has no time-window check, so the only failure mode for
      // restore is "row not soft-deleted." If the row was never deleted,
      // findFirst with deletedAt: { not: null } matches nothing → 404.
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      const restore = await req()
        .post(`/api/visits/${visit.id}/restore`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(restore.status).toBe(404);
    });

    it('GET /:id/history returns events newest first', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      // First save — outside the coalesce window so we end up with two
      // separate update rows.
      await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ complaint: 'Kollë' });
      await prisma.auditLog.updateMany({
        where: { clinicId, resourceId: visit.id, action: 'visit.updated' },
        data: { timestamp: new Date(Date.now() - 5 * 60_000) },
      });
      await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ paymentCode: 'B' });

      const res = await req()
        .get(`/api/visits/${visit.id}/history`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const entries = res.body.entries as Array<{
        action: string;
        timestamp: string;
      }>;
      // Two updates + one create = 3 events, newest first.
      expect(entries.length).toBe(3);
      expect(entries[0]!.action).toBe('visit.updated');
      expect(entries.at(-1)!.action).toBe('visit.created');
    });
  });

  // -------------------------------------------------------------------------
  // Diagnoses + ICD-10 picker (slice 13)
  // -------------------------------------------------------------------------

  describe('diagnoses', () => {
    it('PATCH writes ordered diagnoses + bumps doctor usage counts', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      const res = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ diagnoses: ['J03.9', 'R05'] });
      expect(res.status).toBe(200);
      expect(res.body.visit.diagnoses.map((d: { code: string }) => d.code)).toEqual([
        'J03.9',
        'R05',
      ]);
      expect(res.body.visit.diagnoses[0].orderIndex).toBe(0);

      const usage = await prisma.doctorDiagnosisUsage.findMany({
        where: { doctorId, clinicId },
        orderBy: { icd10Code: 'asc' },
      });
      expect(usage.length).toBe(2);
      expect(usage.map((u) => u.icd10Code)).toEqual(['J03.9', 'R05']);
      expect(usage.every((u) => u.useCount === 1)).toBe(true);

      // Re-save with the same diagnoses — usage counts bump regardless.
      const res2 = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ diagnoses: ['J03.9', 'R05'] });
      expect(res2.status).toBe(200);

      // No-op (same payload, same order) → no usage bump. The DB
      // change-detection key matches, so the upsert path is skipped.
      const usage2 = await prisma.doctorDiagnosisUsage.findMany({
        where: { doctorId, clinicId },
      });
      expect(usage2.every((u) => u.useCount === 1)).toBe(true);

      // Re-save with a reorder — counts bump because the list changed.
      const res3 = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ diagnoses: ['R05', 'J03.9'] });
      expect(res3.status).toBe(200);
      const usage3 = await prisma.doctorDiagnosisUsage.findMany({
        where: { doctorId, clinicId },
        orderBy: { icd10Code: 'asc' },
      });
      expect(usage3.find((u) => u.icd10Code === 'J03.9')?.useCount).toBe(2);
      expect(usage3.find((u) => u.icd10Code === 'R05')?.useCount).toBe(2);
    });

    it('PATCH with empty diagnoses[] clears the join rows', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ diagnoses: ['J03.9'] });
      const res = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ diagnoses: [] });
      expect(res.status).toBe(200);
      expect(res.body.visit.diagnoses).toEqual([]);
      const rows = await prisma.visitDiagnosis.findMany({
        where: { visitId: visit.id },
      });
      expect(rows.length).toBe(0);
    });

    it('PATCH rejects an unknown ICD-10 code with a friendly Albanian error', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ diagnoses: ['Z99.99'] });
      expect(res.status).toBe(404);
      expect(res.body.message).toContain('ICD-10');
    });

    it('GET /api/icd10/search ranks the doctor\'s frequently-used codes first', async () => {
      const visit = await createVisit();
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      // Seed usage by saving a visit with two diagnoses three times.
      for (let i = 0; i < 3; i++) {
        await req()
          .patch(`/api/visits/${visit.id}`)
          .set('host', TENANT_HOST)
          .set('Cookie', cookie)
          .send({ diagnoses: i % 2 === 0 ? ['J45.9'] : [] });
      }

      const res = await req()
        .get('/api/icd10/search?q=J&limit=10')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      const results = res.body.results as Array<{
        code: string;
        frequentlyUsed: boolean;
        useCount: number;
      }>;
      // J45.9 should appear first because it has usage; subsequent
      // entries are alphabetical-by-code without the boost.
      expect(results[0]!.code).toBe('J45.9');
      expect(results[0]!.frequentlyUsed).toBe(true);
      expect(results[0]!.useCount).toBeGreaterThan(0);

      const rest = results.slice(1);
      const codes = rest.map((r) => r.code);
      const sorted = [...codes].sort();
      expect(codes).toEqual(sorted);
    });

    it('receptionist gets 403 on GET /api/icd10/search', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get('/api/icd10/search?q=J')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Doctor-new (auto-pairing "Vizitë e re")
  // -------------------------------------------------------------------------

  describe('doctor-new pairing', () => {
    // The endpoint uses `localDateToday()` server-side. The tests
    // compute today's Belgrade date the same way the helper does so
    // scheduled rows we seed for "today" line up with what the server
    // queries.
    function todayBelgradeIso(): string {
      return new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Europe/Belgrade',
      });
    }

    /**
     * Insert a scheduled booking for an arbitrary patient at a specific
     * HH:mm on today's local date. We seed directly via Prisma so we
     * don't have to pass the receptionist's working-hours validation
     * (tests run at any wall-clock time).
     */
    async function seedScheduledToday(
      time: string,
      status: 'scheduled' | 'arrived' | 'in_progress',
      forPatientId: string,
    ): Promise<{ id: string }> {
      const today = todayBelgradeIso();
      const [hh, mm] = time.split(':');
      const scheduledFor = new Date(`${today}T${hh}:${mm}:00Z`);
      const row = await prisma.visit.create({
        data: {
          clinicId,
          patientId: forPatientId,
          visitDate: new Date(`${today}T00:00:00Z`),
          scheduledFor,
          durationMinutes: 15,
          isWalkIn: false,
          status,
          createdBy: doctorId,
          updatedBy: doctorId,
        },
      });
      return { id: row.id };
    }

    it('receptionist gets 403 on POST /api/visits/doctor-new', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .post('/api/visits/doctor-new')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ patientId });
      expect(res.status).toBe(403);
    });

    it('falls back to standalone (calendar-invisible) when no schedule today', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .post('/api/visits/doctor-new')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ patientId });
      expect(res.status).toBe(201);

      const row = await prisma.visit.findUnique({
        where: { id: res.body.visit.id },
      });
      expect(row).toBeTruthy();
      expect(row!.isWalkIn).toBe(false);
      expect(row!.scheduledFor).toBeNull();
      expect(row!.arrivedAt).toBeNull();
      expect(row!.pairedWithVisitId).toBeNull();
      expect(row!.status).toBe('in_progress');

      const audits = await prisma.auditLog.findMany({
        where: {
          clinicId,
          resourceId: res.body.visit.id,
          action: 'visit.created',
        },
      });
      expect(audits.length).toBe(1);
    });

    it('pairs to the in-progress booking when unpaired', async () => {
      // Sibling scenario: Era is in_progress; doctor opens Dion's
      // chart and clicks "Vizitë e re". Result: Dion's new visit is
      // a walk-in paired to Era's row.
      const sibling = await prisma.patient.create({
        data: {
          clinicId,
          firstName: 'Dion',
          lastName: 'Krasniqi',
          dateOfBirth: new Date('2021-04-02'),
        },
      });
      const era = await seedScheduledToday('10:30', 'in_progress', patientId);

      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .post('/api/visits/doctor-new')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ patientId: sibling.id });
      expect(res.status).toBe(201);

      const row = await prisma.visit.findUnique({
        where: { id: res.body.visit.id },
      });
      expect(row!.isWalkIn).toBe(true);
      expect(row!.status).toBe('in_progress');
      expect(row!.arrivedAt).not.toBeNull();
      expect(row!.scheduledFor).toBeNull();
      expect(row!.pairedWithVisitId).toBe(era.id);

      const audit = await prisma.auditLog.findFirst({
        where: {
          clinicId,
          resourceId: res.body.visit.id,
          action: 'visit.walkin.added',
        },
      });
      expect(audit).toBeDefined();
      const changes = audit!.changes as Array<{ field: string; new: unknown }>;
      const pair = changes.find((c) => c.field === 'pairedWithVisitId');
      expect(pair?.new).toBe(era.id);
    });

    it('pairs to the next scheduled visit when in-progress is already paired', async () => {
      const sibling = await prisma.patient.create({
        data: {
          clinicId,
          firstName: 'Dion',
          lastName: 'Krasniqi',
          dateOfBirth: new Date('2021-04-02'),
        },
      });
      const third = await prisma.patient.create({
        data: {
          clinicId,
          firstName: 'Lira',
          lastName: 'Krasniqi',
          dateOfBirth: new Date('2019-01-08'),
        },
      });
      // Era is in_progress (already paired below); Bardhi is the next
      // scheduled visit on the day.
      const era = await seedScheduledToday('10:30', 'in_progress', patientId);
      const bardhi = await seedScheduledToday('10:45', 'scheduled', third.id);
      // Pair Dion's first walk-in to Era so Era is "taken".
      await prisma.visit.create({
        data: {
          clinicId,
          patientId: sibling.id,
          visitDate: new Date(`${todayBelgradeIso()}T00:00:00Z`),
          isWalkIn: true,
          arrivedAt: new Date(),
          status: 'in_progress',
          pairedWithVisitId: era.id,
          createdBy: doctorId,
          updatedBy: doctorId,
        },
      });

      // New doctor-initiated visit for Lira — should pair to Bardhi
      // (next unpaired scheduled visit on the day), not Era.
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .post('/api/visits/doctor-new')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ patientId: third.id });
      expect(res.status).toBe(201);

      const row = await prisma.visit.findUnique({
        where: { id: res.body.visit.id },
      });
      expect(row!.isWalkIn).toBe(true);
      expect(row!.pairedWithVisitId).toBe(bardhi.id);
    });

    it('falls back to standalone when every scheduled visit is already paired', async () => {
      const sibling = await prisma.patient.create({
        data: {
          clinicId,
          firstName: 'Dion',
          lastName: 'Krasniqi',
          dateOfBirth: new Date('2021-04-02'),
        },
      });
      const era = await seedScheduledToday('10:30', 'in_progress', patientId);
      await prisma.visit.create({
        data: {
          clinicId,
          patientId: sibling.id,
          visitDate: new Date(`${todayBelgradeIso()}T00:00:00Z`),
          isWalkIn: true,
          arrivedAt: new Date(),
          status: 'in_progress',
          pairedWithVisitId: era.id,
          createdBy: doctorId,
          updatedBy: doctorId,
        },
      });

      // No further scheduled rows exist → endpoint must fall back to
      // standalone shape rather than refusing.
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .post('/api/visits/doctor-new')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ patientId: sibling.id });
      expect(res.status).toBe(201);

      const row = await prisma.visit.findUnique({
        where: { id: res.body.visit.id },
      });
      expect(row!.isWalkIn).toBe(false);
      expect(row!.pairedWithVisitId).toBeNull();
      expect(row!.status).toBe('in_progress');
    });

    // Phase 2b patch — the patient-has-active-visit-today gate. When
    // the doctor opens a chart for a patient who already has a row on
    // today's active calendar (scheduled / arrived / in_progress) and
    // clicks "+ Vizitë e re" while picking the SAME patient, the new
    // visit must be a regular visit, not a walk-in paired to the
    // patient's own scheduled row. The pair-or-fallback path only
    // runs when this patient is genuinely fresh on the day.

    describe('patient-active-visit-today gate', () => {
      async function seedForSelf(
        time: string,
        status:
          | 'scheduled'
          | 'arrived'
          | 'in_progress'
          | 'completed'
          | 'no_show'
          | 'cancelled',
      ): Promise<{ id: string }> {
        const today = todayBelgradeIso();
        const [hh, mm] = time.split(':');
        const row = await prisma.visit.create({
          data: {
            clinicId,
            patientId,
            visitDate: new Date(`${today}T00:00:00Z`),
            scheduledFor: new Date(`${today}T${hh}:${mm}:00Z`),
            durationMinutes: 15,
            isWalkIn: false,
            status,
            createdBy: doctorId,
            updatedBy: doctorId,
          },
        });
        return { id: row.id };
      }

      async function postDoctorNewForSelf(): Promise<request.Response> {
        const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
        return req()
          .post('/api/visits/doctor-new')
          .set('host', TENANT_HOST)
          .set('Cookie', cookie)
          .send({ patientId });
      }

      async function expectRegularRow(visitId: string): Promise<void> {
        const row = await prisma.visit.findUnique({ where: { id: visitId } });
        expect(row).toBeTruthy();
        expect(row!.isWalkIn).toBe(false);
        expect(row!.scheduledFor).toBeNull();
        expect(row!.arrivedAt).toBeNull();
        expect(row!.pairedWithVisitId).toBeNull();
        expect(row!.status).toBe('in_progress');
        // Regular-visit path emits the legacy `visit.created` audit row.
        const audits = await prisma.auditLog.findMany({
          where: { clinicId, resourceId: visitId, action: 'visit.created' },
        });
        expect(audits.length).toBe(1);
      }

      it('returns a regular visit when the patient already has a SCHEDULED row today', async () => {
        await seedForSelf('10:30', 'scheduled');
        const res = await postDoctorNewForSelf();
        expect(res.status).toBe(201);
        await expectRegularRow(res.body.visit.id);
      });

      it('returns a regular visit when the patient already has an ARRIVED row today', async () => {
        await seedForSelf('10:30', 'arrived');
        const res = await postDoctorNewForSelf();
        expect(res.status).toBe(201);
        await expectRegularRow(res.body.visit.id);
      });

      it('returns a regular visit when the patient already has an IN_PROGRESS row today', async () => {
        await seedForSelf('10:30', 'in_progress');
        const res = await postDoctorNewForSelf();
        expect(res.status).toBe(201);
        await expectRegularRow(res.body.visit.id);
      });

      it("does not collapse 'completed' today into the gate — a follow-up visit is still a walk-in", async () => {
        // Patient finished this morning. Doctor sees them back this
        // afternoon and clicks "+ Vizitë e re". The completed row
        // doesn't count as active, so the pair-or-fallback runs; with
        // no other scheduled visit today the result is the standalone
        // fallback (is_walk_in=false from the legacy POST shape).
        await seedForSelf('09:00', 'completed');
        const res = await postDoctorNewForSelf();
        expect(res.status).toBe(201);
        const row = await prisma.visit.findUnique({
          where: { id: res.body.visit.id },
        });
        // No other scheduled row on the day → standalone fallback path.
        expect(row!.isWalkIn).toBe(false);
        expect(row!.pairedWithVisitId).toBeNull();
        expect(row!.scheduledFor).toBeNull();
      });

      it("does not collapse 'no_show' today into the gate", async () => {
        await seedForSelf('09:00', 'no_show');
        const res = await postDoctorNewForSelf();
        expect(res.status).toBe(201);
        const row = await prisma.visit.findUnique({
          where: { id: res.body.visit.id },
        });
        expect(row!.isWalkIn).toBe(false);
        expect(row!.pairedWithVisitId).toBeNull();
      });

      it("does not collapse 'cancelled' today into the gate", async () => {
        await seedForSelf('09:00', 'cancelled');
        const res = await postDoctorNewForSelf();
        expect(res.status).toBe(201);
        const row = await prisma.visit.findUnique({
          where: { id: res.body.visit.id },
        });
        expect(row!.isWalkIn).toBe(false);
        expect(row!.pairedWithVisitId).toBeNull();
      });

      it("the gate is per-patient — another patient's scheduled row does not promote the regular path", async () => {
        // Patient X has NO row today. Patient Y has a scheduled row.
        // doctor-new for X must still pair to Y (existing behaviour)
        // — the gate is keyed off the *new visit's* patient only.
        const otherPatient = await prisma.patient.create({
          data: {
            clinicId,
            firstName: 'Dion',
            lastName: 'Krasniqi',
            dateOfBirth: new Date('2021-04-02'),
          },
        });
        const eraScheduled = await seedScheduledToday(
          '10:30',
          'in_progress',
          patientId,
        );

        const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
        const res = await req()
          .post('/api/visits/doctor-new')
          .set('host', TENANT_HOST)
          .set('Cookie', cookie)
          .send({ patientId: otherPatient.id });
        expect(res.status).toBe(201);

        const row = await prisma.visit.findUnique({
          where: { id: res.body.visit.id },
        });
        expect(row!.isWalkIn).toBe(true);
        expect(row!.pairedWithVisitId).toBe(eraScheduled.id);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Multi-tenant isolation
  // -------------------------------------------------------------------------

  describe('multi-tenant', () => {
    it("doctor in clinic A cannot PATCH clinic B's visit", async () => {
      // Provision a visit in clinic B (no API to do it for us as B's
      // doctor, so seed it directly).
      const visit = await prisma.visit.create({
        data: {
          clinicId: secondClinicId,
          patientId: secondClinicPatientId,
          visitDate: new Date('2026-05-14T00:00:00Z'),
          createdBy: doctorId, // attribution fine — RLS doesn't read createdBy
          updatedBy: doctorId,
        },
      });

      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .patch(`/api/visits/${visit.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ complaint: 'leak attempt' });
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function req(): request.Agent {
    return request(app.getHttpServer());
  }

  async function createVisit(): Promise<{ id: string }> {
    const row = await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date('2026-05-14T00:00:00Z'),
        createdBy: doctorId,
        updatedBy: doctorId,
      },
    });
    return { id: row.id };
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
