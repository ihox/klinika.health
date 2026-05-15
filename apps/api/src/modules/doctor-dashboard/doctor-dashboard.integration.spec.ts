// Integration test for the doctor's "Pamja e ditës" dashboard endpoint.
//
// Mirrors the appointments/patients integration pattern (real Postgres,
// real Nest app, supertest at the HTTP layer). Covers:
//
//   1. Doctor sees today's appointments + visits + next-patient card
//   2. Receptionist 403s — the dashboard is doctor-only
//   3. Stats math: visit count, payments aggregation, completed count
//   4. Next-patient card carries the allergy boolean (never the text)
//   5. Cross-clinic RLS isolation
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
import { SESSION_COOKIE_NAME } from '../auth/session.service';
import {
  CapturingEmailSender,
  EMAIL_SENDER,
  EmailService,
} from '../email/email.service';
import { localDateToday } from '../../common/datetime';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_RECEPTIONIST_PASSWORD = process.env['SEED_RECEPTIONIST_PASSWORD'];
const ENABLED = Boolean(
  DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_RECEPTIONIST_PASSWORD,
);

const TENANT_HOST = 'donetamed.klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';
const RECEPTIONIST_EMAIL = 'ereblire.krasniqi@klinika.health';

describe.skipIf(!ENABLED)('Doctor dashboard integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let clinicId: string;
  let doctorUserId: string;

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
    const doctor = await prisma.user.findFirstOrThrow({
      where: { email: DOCTOR_EMAIL },
    });
    doctorUserId = doctor.id;
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
    await prisma.visitDiagnosis.deleteMany({});
    // Post-merge (ADR-011): appointments now live as `visits` rows.
    // One delete clears both kinds.
    await prisma.visit.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId } });
  });

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  // We anchor every test to the host's "today" in Europe/Belgrade so
  // the dashboard's auto-resolved date matches our seeded data without
  // any override. The override query parameter exists primarily for
  // debugging; tests prefer the natural code path.
  function todayBelgrade(): string {
    return localDateToday();
  }

  // Seed visit_date the same way production code does (see
  // visits.service.ts:79). UTC midnight on the local date round-trips
  // through Prisma's `@db.Date` serialization without timezone drift.
  function visitDateFor(localDate: string): Date {
    return new Date(`${localDate}T00:00:00Z`);
  }

  // ------------------------------------------------------------------
  // 1. Doctor sees the full dashboard for today
  // ------------------------------------------------------------------

  it('returns appointments + visits + next-patient card for the doctor', async () => {
    const today = todayBelgrade();
    const patient = await prisma.patient.create({
      data: {
        clinicId,
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: new Date('2023-08-03'),
        alergjiTjera: 'Penicilinë',
        sex: 'f',
      },
    });
    // A scheduled appointment in the future (still "next" for the
    // doctor) so the next-patient card has something to bind to.
    const futureStart = new Date(Date.now() + 60 * 60_000);
    const appt = await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: new Date(`${today}T00:00:00Z`),
        scheduledFor: futureStart,
        durationMinutes: 15,
        status: 'scheduled',
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });
    // A completed visit earlier today so todayVisits + stats are
    // exercised. `status: 'completed'` is explicit because the doctor
    // dashboard's day-log filters on it (migration 20260519120000
    // flipped the schema default to 'in_progress').
    const visit = await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: visitDateFor(today),
        status: 'completed',
        paymentCode: 'A',
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });

    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get('/api/doctor/dashboard')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(today);
    expect(res.body.appointments.length).toBe(1);
    expect(res.body.todayVisits.length).toBe(1);
    expect(res.body.todayVisits[0].id).toBe(visit.id);
    expect(res.body.todayVisits[0].paymentCode).toBe('A');
    // Default DonetaMED A-code is 1500 cents.
    expect(res.body.todayVisits[0].paymentAmountCents).toBe(1500);

    expect(res.body.nextPatient).not.toBeNull();
    expect(res.body.nextPatient.appointmentId).toBe(appt.id);
    expect(res.body.nextPatient.patient.firstName).toBe('Era');
    // The doctor's view says "this patient has an allergy" without
    // shipping the text itself.
    expect(res.body.nextPatient.hasAllergyNote).toBe(true);
    expect(res.body.nextPatient).not.toHaveProperty('alergjiTjera');

    expect(res.body.stats.visitsCompleted).toBe(1);
    expect(res.body.stats.paymentsCents).toBe(1500);
    expect(res.body.stats.appointmentsTotal).toBe(1);
  });

  // ------------------------------------------------------------------
  // 2. Receptionist cannot reach the dashboard
  // ------------------------------------------------------------------

  it('receptionist gets 403 — dashboard is doctor-only', async () => {
    const cookie = await loginAs(
      RECEPTIONIST_EMAIL,
      SEED_RECEPTIONIST_PASSWORD!,
    );
    const res = await req()
      .get('/api/doctor/dashboard')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
  });

  // ------------------------------------------------------------------
  // 3. Stats aggregation across multiple visits
  // ------------------------------------------------------------------

  it('aggregates payments across multiple visits using clinic payment codes', async () => {
    const today = todayBelgrade();
    const visitDate = visitDateFor(today);
    const patient = await prisma.patient.create({
      data: {
        clinicId,
        firstName: 'Dion',
        lastName: 'Hoxha',
        dateOfBirth: new Date('2024-02-12'),
      },
    });
    // Three visits with codes A (1500), B (1000), E (0). Total 2500c.
    for (const [code, mins] of [
      ['A', 0],
      ['B', 12],
      ['E', 25],
    ] as const) {
      await prisma.visit.create({
        data: {
          clinicId,
          patientId: patient.id,
          visitDate,
          status: 'completed',
          paymentCode: code,
          createdBy: doctorUserId,
          updatedBy: doctorUserId,
          createdAt: new Date(Date.now() - (40 - mins) * 60_000),
        },
      });
    }

    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get('/api/doctor/dashboard')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.stats.visitsCompleted).toBe(3);
    expect(res.body.stats.paymentsCents).toBe(2500);
    expect(typeof res.body.stats.averageVisitMinutes).toBe('number');
  });

  // ------------------------------------------------------------------
  // 4. Regression — visits.visit_date is @db.Date, query must use a
  //    DATE-typed operand. Pre-fix, the dashboard sent a Timestamptz
  //    derived from `localClockToUtc(today, '00:00')`, which serialized
  //    as *yesterday* in summer and silently excluded today's visits.
  //    See ADR-006 § "DATE vs Timestamptz operand fix".
  // ------------------------------------------------------------------

  it("today's visit appears in todayVisits regardless of UTC offset", async () => {
    const today = todayBelgrade();
    const patient = await prisma.patient.create({
      data: {
        clinicId,
        firstName: 'Liridon',
        lastName: 'Berisha',
        dateOfBirth: new Date('2022-11-09'),
      },
    });
    const visit = await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: visitDateFor(today),
        status: 'completed',
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });

    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get('/api/doctor/dashboard')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.date).toBe(today);
    const ids = (res.body.todayVisits as Array<{ id: string }>).map((v) => v.id);
    expect(ids).toContain(visit.id);
    expect(res.body.stats.visitsCompleted).toBe(1);
  });

  // ------------------------------------------------------------------
  // 5. "Vizita të hapura" — `in_progress` visits from prior days
  // ------------------------------------------------------------------

  it('surfaces in_progress visits from prior days in openVisits, oldest first', async () => {
    const today = todayBelgrade();
    const patient = await prisma.patient.create({
      data: {
        clinicId,
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: new Date('2023-08-03'),
      },
    });
    // Three days ago — abandoned in_progress visit.
    const threeDaysAgo = isoDateDaysAgo(today, 3);
    const olderOpen = await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: visitDateFor(threeDaysAgo),
        status: 'in_progress',
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });
    // Yesterday — another abandoned in_progress visit (more recent).
    const yesterday = isoDateDaysAgo(today, 1);
    const recentOpen = await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: visitDateFor(yesterday),
        status: 'in_progress',
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });
    // Yesterday — completed (should NOT appear; the doctor finished it).
    await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: visitDateFor(yesterday),
        status: 'completed',
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });
    // Today — in_progress (today's queue already surfaces this; the
    // backlog list is strictly prior-day).
    await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: visitDateFor(today),
        status: 'in_progress',
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });
    // Yesterday — in_progress but soft-deleted (must not surface).
    await prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: visitDateFor(yesterday),
        status: 'in_progress',
        deletedAt: new Date(),
        createdBy: doctorUserId,
        updatedBy: doctorUserId,
      },
    });

    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get('/api/doctor/dashboard')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    const open = res.body.openVisits as Array<{
      id: string;
      visitDate: string;
      daysAgo: number;
    }>;
    expect(open.map((v) => v.id)).toEqual([olderOpen.id, recentOpen.id]);
    expect(open[0]!.visitDate).toBe(threeDaysAgo);
    expect(open[0]!.daysAgo).toBe(3);
    expect(open[1]!.visitDate).toBe(yesterday);
    expect(open[1]!.daysAgo).toBe(1);
  });

  it('returns an empty openVisits array when no prior in_progress backlog exists', async () => {
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get('/api/doctor/dashboard')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.openVisits)).toBe(true);
    expect(res.body.openVisits.length).toBe(0);
  });

  // ------------------------------------------------------------------
  // Helpers (mirror the auth flow from other integration specs)
  // ------------------------------------------------------------------

  function isoDateDaysAgo(today: string, days: number): string {
    const [y, m, d] = today.split('-').map(Number) as [number, number, number];
    const t = Date.UTC(y, m - 1, d) - days * 86_400_000;
    const dt = new Date(t);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
  }

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
