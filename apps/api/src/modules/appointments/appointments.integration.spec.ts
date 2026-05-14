// Integration tests for the appointments API surface.
//
// Mirrors the patients integration pattern (real Postgres, real Nest
// app, supertest at the HTTP layer). Covers:
//
//   1. Receptionist creates an appointment, list returns it
//   2. Working-hours validation rejects out-of-hours slots
//   3. Conflict detection rejects overlapping bookings
//   4. PATCH updates emit audit-log diffs with old/new
//   5. Soft delete + restore round-trip
//   6. Stats endpoint reflects current state
//   7. Unmarked-past surfaces stale 'scheduled' appointments
//   8. Cross-clinic RLS isolation
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
import { CapturingEmailSender, EMAIL_SENDER, EmailService } from '../email/email.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_RECEPTIONIST_PASSWORD = process.env['SEED_RECEPTIONIST_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_RECEPTIONIST_PASSWORD);

const TENANT_HOST = 'donetamed.klinika.health';
const RECEPTIONIST_EMAIL = 'ereblire.krasniqi@klinika.health';

describe.skipIf(!ENABLED)('Appointments integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let clinicId: string;
  let secondClinicId: string;
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

    const clinic = await prisma.clinic.findFirstOrThrow({ where: { subdomain: 'donetamed' } });
    clinicId = clinic.id;

    const second = await prisma.clinic.upsert({
      where: { subdomain: 'second-appts' },
      update: {},
      create: {
        subdomain: 'second-appts',
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
    // Post-merge (ADR-011): appointments now live as `visits` rows with
    // `scheduled_for IS NOT NULL`. We wipe every visit row in each test
    // clinic to keep the test isolated.
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
      },
    });
    patientId = patient.id;
  });

  // The seed and beforeEach run on the host's "today" so we anchor the
  // tests to a deterministic open weekday that is in the future relative
  // to `now` (so stats' nextAppointment logic exercises). We pick a
  // Wednesday far enough out to never be a closed Sunday.
  function nextOpenDate(daysAhead = 7): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    // Push to a Wednesday for stability across DST.
    while (d.getUTCDay() !== 3) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  it('receptionist can create + list an appointment, and the audit log records both', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const createRes = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    expect(createRes.status).toBe(201);
    const created = createRes.body.appointment;
    expect(created.status).toBe('scheduled');
    expect(created.patient.firstName).toBe('Era');

    const listRes = await req()
      .get(`/api/appointments?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(listRes.status).toBe(200);
    expect(listRes.body.appointments).toHaveLength(1);

    const audit = await prisma.auditLog.findMany({
      // Post-merge (ADR-011): the audit row points at the unified
      // `visits` row via `resource_type='visit'`; the `action` prefix
      // stays `appointment.*` so receptionist-scheduling intent is
      // still legible.
      where: { clinicId, resourceType: 'visit', resourceId: created.id },
    });
    expect(audit.length).toBeGreaterThanOrEqual(1);
    const create = audit.find((a) => a.action === 'appointment.created');
    expect(create).toBeDefined();
    const changes = create!.changes as Array<{ field: string }>;
    expect(changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['patientId', 'scheduledFor', 'durationMinutes', 'status']),
    );
  });

  it('rejects appointments outside working hours', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const res = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '08:00', durationMinutes: 15 });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('before_open');
  });

  it('rejects appointments that overlap an existing one', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const first = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 20 });
    expect(first.status).toBe(201);

    const conflict = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:40', durationMinutes: 15 });
    expect(conflict.status).toBe(400);
    expect(conflict.body.reason).toBe('conflict');
  });

  it('PATCH status emits an audit diff and updates the row', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    expect(create.status).toBe(201);
    const id = create.body.appointment.id;

    const patch = await req()
      .patch(`/api/appointments/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'no_show' });
    expect(patch.status).toBe(200);
    expect(patch.body.appointment.status).toBe('no_show');

    const audit = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'appointment.updated', resourceId: id },
    });
    expect(audit).toBeDefined();
    const changes = audit!.changes as Array<{ field: string; old: unknown; new: unknown }>;
    const statusChange = changes.find((c) => c.field === 'status');
    expect(statusChange).toEqual({ field: 'status', old: 'scheduled', new: 'no_show' });
  });

  it('soft delete + restore round-trips with a 30s undo window', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '11:00', durationMinutes: 15 });
    const id = create.body.appointment.id;

    const del = await req()
      .delete(`/api/appointments/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(del.status).toBe(200);
    expect(typeof del.body.restorableUntil).toBe('string');
    const window = Date.parse(del.body.restorableUntil) - Date.now();
    expect(window).toBeGreaterThan(20_000);
    expect(window).toBeLessThan(35_000);

    const list = await req()
      .get(`/api/appointments?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(list.body.appointments).toHaveLength(0);

    const restore = await req()
      .post(`/api/appointments/${id}/restore`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(restore.status).toBe(200);

    const listAgain = await req()
      .get(`/api/appointments?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(listAgain.body.appointments).toHaveLength(1);
  });

  it('restore on an appointment that was never deleted returns 404', async () => {
    // The 30-second undo window (ADR-008) is client-side only — the
    // server has no time-window check, so the only failure mode for
    // restore is "row not soft-deleted." If the row was never deleted,
    // findFirst with deletedAt: { not: null } matches nothing → 404.
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '12:30', durationMinutes: 15 });
    const id = create.body.appointment.id;

    const restore = await req()
      .post(`/api/appointments/${id}/restore`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(restore.status).toBe(404);
  });

  it('stats endpoint reports counts and the next appointment', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '11:00', durationMinutes: 15 });
    await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '11:30', durationMinutes: 15 });

    const res = await req()
      .get(`/api/appointments/stats?date=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.scheduled).toBe(2);
    expect(res.body.nextAppointment).not.toBeNull();
  });

  it('unmarked-past surfaces a stale scheduled appointment from yesterday', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    // Insert directly (we can't create in the past via the API — working
    // hours + conflict check don't care about the past, but the API
    // wouldn't normally book yesterday). Anchor the time to noon UTC so
    // it lands on the prior local day in Europe/Belgrade.
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setUTCHours(10, 0, 0, 0);
    const creator = await prisma.user.findFirstOrThrow({ where: { clinicId } });
    const stale = await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${yesterday.toISOString().slice(0, 10)}T00:00:00Z`),
        scheduledFor: yesterday,
        durationMinutes: 15,
        status: 'scheduled',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });

    const res = await req()
      .get('/api/appointments/unmarked-past')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    const ids = (res.body.appointments as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(stale.id);
  });

  // Audit-shape invariant (Phase 1 of the visits merge, ADR-011)
  //
  // The translation layer keeps the `action` prefix `appointment.*` so a
  // receptionist-side scheduling change still reads as such in the
  // history, but the row's `resource_type` is `'visit'` because the
  // underlying record lives in the unified `visits` table — there is no
  // longer an `appointments` table to point at. This test pins both
  // halves of the contract across the create / update / soft-delete /
  // restore cycle, and asserts no orphaned `resource_type='appointment'`
  // rows are produced.
  it('appointment mutations write audit rows with resource_type=visit + action=appointment.*', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '11:15', durationMinutes: 15 });
    expect(create.status).toBe(201);
    const id = create.body.appointment.id;

    await req()
      .patch(`/api/appointments/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'no_show' });

    await req()
      .delete(`/api/appointments/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);

    const rows = await prisma.auditLog.findMany({
      where: { clinicId, resourceId: id },
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.resourceType).toBe('visit');
      expect(r.action).toMatch(/^appointment\./);
    }
    // No stray `resource_type='appointment'` rows anywhere in this
    // clinic's log after the merge.
    const legacy = await prisma.auditLog.count({
      where: { clinicId, resourceType: 'appointment' },
    });
    expect(legacy).toBe(0);
  });

  // ----------------------------------------------------------------------
  // Translation-layer invariant (Phase 1 of the visits merge, ADR-011)
  //
  // After the merge, appointments and visits share a single `visits` table.
  // The appointments endpoints must therefore filter every read by
  // `scheduled_for IS NOT NULL` (the APPT_BASE_WHERE predicate in
  // AppointmentsService) so a doctor-only clinical visit — one created
  // via "[Vizitë e re]" with no prior booking — never leaks into the
  // receptionist's calendar feed.
  //
  // We seed a row that satisfies the doctor-side invariant (clinical
  // content present, `scheduled_for=null`, status='completed') and assert
  // it is invisible to `GET /api/appointments` even when the local day
  // matches and the patient is in the same clinic.
  // ----------------------------------------------------------------------

  it('doctor-only visits (scheduled_for=null) are invisible to GET /api/appointments', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const creator = await prisma.user.findFirstOrThrow({ where: { clinicId } });

    // Doctor-only visit — same clinic + patient + local day as the
    // appointments query, but `scheduled_for` is null so it must stay
    // off the receptionist's calendar.
    const doctorOnly = await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${date}T00:00:00Z`),
        // scheduledFor omitted — null
        // durationMinutes omitted — null
        status: 'completed',
        complaint: 'Kontroll pa terminim — i regjistruar drejtpërdrejt nga mjeku.',
        paymentCode: 'A',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });

    // And a normal appointment so the response isn't trivially empty.
    const booking = await req()
      .post('/api/appointments')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '13:00', durationMinutes: 15 });
    expect(booking.status).toBe(201);

    const list = await req()
      .get(`/api/appointments?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(list.status).toBe(200);
    const ids = (list.body.appointments as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(booking.body.appointment.id);
    expect(ids).not.toContain(doctorOnly.id);
  });

  it('RLS isolation: clinic A cookie cannot reach clinic B data', async () => {
    // Seed an appointment in clinic B that we will try (and fail) to
    // read with clinic A's session.
    const cookieA = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const adminUserB = await prisma.user.findFirst({ where: { clinicId: secondClinicId } });
    if (!adminUserB) {
      // Without a user in the second clinic we can't create an appointment
      // there; create a minimal one.
      await prisma.user.create({
        data: {
          clinicId: secondClinicId,
          email: 'second-rls@second-appts.health',
          passwordHash: 'x',
          roles: ['receptionist'],
          firstName: 'X',
          lastName: 'Y',
        },
      });
    }
    const userB = await prisma.user.findFirstOrThrow({ where: { clinicId: secondClinicId } });
    const patientB = await prisma.patient.create({
      data: {
        clinicId: secondClinicId,
        firstName: 'Cross',
        lastName: 'Tenant',
        dateOfBirth: new Date('2022-01-01'),
      },
    });
    const futureUtc = new Date(Date.now() + 7 * 86_400_000);
    futureUtc.setUTCHours(10, 0, 0, 0);
    const apptB = await prisma.visit.create({
      data: {
        clinicId: secondClinicId,
        patientId: patientB.id,
        visitDate: new Date(`${futureUtc.toISOString().slice(0, 10)}T00:00:00Z`),
        scheduledFor: futureUtc,
        durationMinutes: 15,
        status: 'scheduled',
        createdBy: userB.id,
        updatedBy: userB.id,
      },
    });

    const date = nextOpenDate();
    const res = await req()
      .get(`/api/appointments?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookieA);
    expect(res.status).toBe(200);
    const ids = (res.body.appointments as Array<{ id: string }>).map((a) => a.id);
    expect(ids).not.toContain(apptB.id);
  });

  // ----------------------------------------------------------------------
  // Helpers (mirror patients.integration.spec.ts)
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
