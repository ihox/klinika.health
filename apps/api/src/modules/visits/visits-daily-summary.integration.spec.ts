// Integration tests for GET /api/visits/daily-summary (the /raporti
// page's data source).
//
// Covers:
//   1. Doctor + clinic_admin reach the endpoint and get the full shape
//   2. Receptionist reaches the endpoint for today and yesterday
//   3. Receptionist 403 for older + future dates (server-side guard)
//   4. Aggregation correctness with mixed-status visits
//   5. Audit row written on every successful read
//   6. Cross-clinic isolation
//
// Skips when DATABASE_URL or the seed passwords aren't set — same
// gate as `visits.integration.spec.ts`.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CapturingEmailSender,
  EMAIL_SENDER,
  EmailService,
} from '../email/email.service';
import { SESSION_COOKIE_NAME } from '../auth/session.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_RECEPTIONIST_PASSWORD = process.env['SEED_RECEPTIONIST_PASSWORD'];
const ENABLED = Boolean(
  DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_RECEPTIONIST_PASSWORD,
);

const TENANT_HOST = 'donetamed.klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';
const RECEPTIONIST_EMAIL = 'ereblire.krasniqi@klinika.health';

describe.skipIf(!ENABLED)('Visits daily-summary integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let clinicId: string;
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
    await prisma.visitDicomLink.deleteMany({});
    await prisma.visitDiagnosis.deleteMany({});
    await prisma.visit.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId } });

    const patient = await prisma.patient.create({
      data: {
        clinicId,
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: new Date('2018-04-12'),
        sex: 'f',
      },
    });
    patientId = patient.id;
  });

  // -------------------------------------------------------------------------
  // Doctor — happy path + aggregation
  // -------------------------------------------------------------------------

  it('doctor: returns aggregated shape for today with mixed statuses', async () => {
    const today = todayBelgradeIso();
    await seedVisit(today, '08:30', 'completed', 'A');
    await seedVisit(today, '09:00', 'completed', 'B');
    await seedVisit(today, '09:30', 'completed', 'E');
    await seedVisit(today, '10:00', 'no_show', null);
    await seedVisit(today, '11:00', 'scheduled', null);

    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get(`/api/visits/daily-summary?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);

    expect(res.body.date).toBe(today);
    expect(res.body.visitCount).toBe(5);
    expect(res.body.totalRevenueCents).toBe(1500 + 1000 + 0);
    // E (Falas) excluded from paidCount even though completed.
    expect(res.body.paidCount).toBe(2);
    expect(res.body.statusBreakdown).toEqual({
      scheduled: 1,
      arrived: 0,
      in_progress: 0,
      completed: 3,
      no_show: 1,
    });
    const a = res.body.paymentCodeBreakdown.find(
      (e: { code: string }) => e.code === 'A',
    );
    expect(a?.count).toBe(1);
    expect(a?.totalCents).toBe(1500);
    const b = res.body.paymentCodeBreakdown.find(
      (e: { code: string }) => e.code === 'B',
    );
    expect(b?.count).toBe(1);
    expect(b?.totalCents).toBe(1000);
    expect(res.body.visits.length).toBe(5);
    // Visits ordered by scheduledFor / arrivedAt / createdAt ascending.
    expect(res.body.visits[0].time).toBe('08:30');
    expect(res.body.visits[0].patient.firstName).toBe('Era');
  });

  it('doctor: writes a report.daily.read audit row with the date as resourceId', async () => {
    const today = todayBelgradeIso();
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get(`/api/visits/daily-summary?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);

    const audits = await prisma.auditLog.findMany({
      where: { clinicId, action: 'report.daily.read' },
    });
    expect(audits.length).toBe(1);
    expect(audits[0]?.resourceType).toBe('report');
    expect(audits[0]?.resourceId).toBe(today);
    expect(audits[0]?.changes).toBeNull();
  });

  it('doctor: accepts a far-past date with no restriction', async () => {
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get(`/api/visits/daily-summary?date=2020-01-15`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.visitCount).toBe(0);
  });

  it('doctor: accepts a far-future date with no restriction', async () => {
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get(`/api/visits/daily-summary?date=2099-12-31`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Receptionist — date guard
  // -------------------------------------------------------------------------

  it('receptionist: 200 on today', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const today = todayBelgradeIso();
    const res = await req()
      .get(`/api/visits/daily-summary?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('receptionist: 200 on yesterday', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const yesterday = previousDayIso(todayBelgradeIso());
    const res = await req()
      .get(`/api/visits/daily-summary?date=${yesterday}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  it('receptionist: 403 with date_out_of_range on two days ago', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const twoDaysAgo = previousDayIso(previousDayIso(todayBelgradeIso()));
    const res = await req()
      .get(`/api/visits/daily-summary?date=${twoDaysAgo}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('date_out_of_range');
    expect(res.body.message).toContain('Nuk keni qasje');
  });

  it('receptionist: 403 on a future date', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    // Use a clearly-future date so any DST drift can't accidentally
    // make this "today".
    const res = await req()
      .get(`/api/visits/daily-summary?date=2099-01-01`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('date_out_of_range');
  });

  // -------------------------------------------------------------------------
  // Cross-clinic isolation
  // -------------------------------------------------------------------------

  it('does not surface visits from a different clinic', async () => {
    const today = todayBelgradeIso();
    // Create a sibling clinic + patient + visit; the donetamed login
    // must NOT see it.
    const other = await prisma.clinic.upsert({
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
          durations: [15],
          defaultDuration: 15,
        },
        paymentCodes: {
          A: { label: 'Standard', amountCents: 1500 },
          E: { label: 'Falas', amountCents: 0 },
        },
        logoUrl: '',
        signatureUrl: '',
      },
    });
    const crossPatient = await prisma.patient.create({
      data: {
        clinicId: other.id,
        firstName: 'Cross',
        lastName: 'Clinic',
        dateOfBirth: new Date('2020-01-01'),
      },
    });
    await prisma.visit.create({
      data: {
        clinicId: other.id,
        patientId: crossPatient.id,
        visitDate: new Date(`${today}T00:00:00Z`),
        scheduledFor: new Date(`${today}T09:00:00Z`),
        durationMinutes: 15,
        isWalkIn: false,
        status: 'completed',
        paymentCode: 'A',
        createdBy: doctorId,
        updatedBy: doctorId,
      },
    });

    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const res = await req()
      .get(`/api/visits/daily-summary?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.visits.every((v: { patient: { firstName: string } }) =>
      v.patient.firstName !== 'Cross',
    )).toBe(true);

    // Cleanup the sibling rows so the next test starts clean.
    await prisma.visit.deleteMany({ where: { clinicId: other.id } });
    await prisma.patient.deleteMany({ where: { clinicId: other.id } });
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function req(): request.Agent {
    return request(app.getHttpServer());
  }

  function todayBelgradeIso(): string {
    return new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Belgrade',
    });
  }

  function previousDayIso(iso: string): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  async function seedVisit(
    date: string,
    time: string,
    status: 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'no_show',
    paymentCode: 'A' | 'B' | 'C' | 'D' | 'E' | null,
  ): Promise<void> {
    const [hh, mm] = time.split(':');
    const scheduledFor = new Date(`${date}T${hh}:${mm}:00Z`);
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${date}T00:00:00Z`),
        scheduledFor,
        durationMinutes: 15,
        isWalkIn: false,
        status,
        paymentCode,
        createdBy: doctorId,
        updatedBy: doctorId,
      },
    });
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
