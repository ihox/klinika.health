// Integration tests for the unified visits calendar API.
//
// Mirrors the patients integration pattern (real Postgres, real Nest
// app, supertest at the HTTP layer). Covers:
//
//   1. Receptionist creates a scheduled visit; list returns it
//   2. Working-hours validation rejects out-of-hours slots
//   3. Conflict detection rejects overlapping bookings
//   4. PATCH /:id/scheduling reschedules and writes an audit diff
//   5. PATCH /:id/status validates the lifecycle matrix
//   6. POST /walkin creates a walk-in with arrived_at + status=arrived
//   7. Stats endpoint reflects walk-ins + scheduled separately
//   8. Soft delete + restore round-trip
//   9. Soft delete refused on rows carrying clinical data
//  10. Receptionist response shape redacts paymentCode
//  11. Cross-clinic RLS isolation
//  12. Audit-shape: resource_type=visit, action=visit.*
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
import { VisitsCalendarService } from './visits-calendar.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_RECEPTIONIST_PASSWORD = process.env['SEED_RECEPTIONIST_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_RECEPTIONIST_PASSWORD);

const TENANT_HOST = 'donetamed.klinika.health';
const RECEPTIONIST_EMAIL = 'ereblire.krasniqi@klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';

describe.skipIf(!ENABLED)('Visits calendar integration', () => {
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
      where: { subdomain: 'second-calendar' },
      update: {},
      create: {
        subdomain: 'second-calendar',
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

  // Anchor tests to a deterministic open weekday a week in the future so
  // the stats endpoint exercises the nextAppointment branch.
  function nextOpenDate(daysAhead = 7): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    while (d.getUTCDay() !== 3) {
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  // -----------------------------------------------------------------------
  // 1. Create scheduled + list
  // -----------------------------------------------------------------------

  it('receptionist creates a scheduled visit; list returns it with status=scheduled and isWalkIn=false', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const created = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    expect(created.status).toBe(201);
    const entry = created.body.entry;
    expect(entry.status).toBe('scheduled');
    expect(entry.isWalkIn).toBe(false);
    expect(entry.scheduledFor).toBeTruthy();
    expect(entry.durationMinutes).toBe(15);
    expect(entry.arrivedAt).toBeNull();
    expect(entry.patient.firstName).toBe('Era');
    // Receptionist privacy boundary: paymentCode is redacted.
    expect(entry.paymentCode).toBeNull();

    const list = await req()
      .get(`/api/visits/calendar?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.entries).toHaveLength(1);
    expect(list.body.entries[0].id).toBe(entry.id);

    const audit = await prisma.auditLog.findMany({
      where: { clinicId, resourceType: 'visit', resourceId: entry.id },
    });
    const create = audit.find((a) => a.action === 'visit.scheduled');
    expect(create).toBeDefined();
    const changes = create!.changes as Array<{ field: string }>;
    expect(changes.map((c) => c.field)).toEqual(
      expect.arrayContaining(['patientId', 'scheduledFor', 'durationMinutes', 'status']),
    );
  });

  // -----------------------------------------------------------------------
  // 2. Working-hours validation
  // -----------------------------------------------------------------------

  it('rejects scheduled visits outside working hours', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const res = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '08:00', durationMinutes: 15 });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('before_open');
  });

  // -----------------------------------------------------------------------
  // 3. Conflict detection
  // -----------------------------------------------------------------------

  it('rejects overlapping scheduled visits', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const first = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 20 });
    expect(first.status).toBe(201);

    const conflict = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:40', durationMinutes: 15 });
    expect(conflict.status).toBe(400);
    expect(conflict.body.reason).toBe('conflict');
  });

  // -----------------------------------------------------------------------
  // 4. Reschedule via PATCH /:id/scheduling
  // -----------------------------------------------------------------------

  it('PATCH /:id/scheduling moves a booking and writes a scheduledFor diff', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    const id = create.body.entry.id;

    const patch = await req()
      .patch(`/api/visits/${id}/scheduling`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ time: '11:00' });
    expect(patch.status).toBe(200);
    expect(patch.body.entry.id).toBe(id);

    const audit = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'visit.rescheduled', resourceId: id },
    });
    expect(audit).toBeDefined();
    const changes = audit!.changes as Array<{ field: string; old: unknown; new: unknown }>;
    const sf = changes.find((c) => c.field === 'scheduledFor');
    expect(sf).toBeDefined();
    expect(sf!.old).not.toEqual(sf!.new);
  });

  // -----------------------------------------------------------------------
  // 5. PATCH /:id/status — validates the lifecycle matrix
  // -----------------------------------------------------------------------

  it('PATCH /:id/status allows scheduled → arrived and stamps arrivedAt', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    const id = create.body.entry.id;

    const ok = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'arrived' });
    expect(ok.status).toBe(200);
    expect(ok.body.entry.status).toBe('arrived');
    expect(ok.body.entry.arrivedAt).not.toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'visit.status_changed', resourceId: id },
    });
    expect(audit).toBeDefined();
    const changes = audit!.changes as Array<{ field: string; old: unknown; new: unknown }>;
    const statusChange = changes.find((c) => c.field === 'status');
    expect(statusChange).toEqual({ field: 'status', old: 'scheduled', new: 'arrived' });
  });

  it('PATCH /:id/status rejects scheduled → in_progress (not in matrix)', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    const id = create.body.entry.id;

    const bad = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'in_progress' });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe('invalid_transition');
    expect(bad.body.from).toBe('scheduled');
    expect(bad.body.to).toBe('in_progress');
  });

  it('PATCH /:id/status allows no_show → arrived (Rikthe te paraqitur)', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    const id = create.body.entry.id;

    await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'no_show' })
      .expect(200);

    const reopen = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'arrived' });
    expect(reopen.status).toBe(200);
    expect(reopen.body.entry.status).toBe('arrived');
    expect(reopen.body.entry.arrivedAt).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // 6. Walk-in (with pairing rule — CLAUDE.md §13)
  // -----------------------------------------------------------------------

  it('POST /walkin creates an arrived row paired to a scheduled visit', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const scheduled = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '10:30', durationMinutes: 15 });
    expect(scheduled.status).toBe(201);
    const pairedWithVisitId = scheduled.body.entry.id;

    const res = await req()
      .post('/api/visits/walkin')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, pairedWithVisitId });
    expect(res.status).toBe(201);
    const entry = res.body.entry;
    expect(entry.isWalkIn).toBe(true);
    expect(entry.status).toBe('arrived');
    expect(entry.scheduledFor).toBeNull();
    expect(entry.durationMinutes).toBeNull();
    expect(entry.arrivedAt).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'visit.walkin.added', resourceId: entry.id },
    });
    expect(audit).toBeDefined();
    expect(audit!.resourceType).toBe('visit');
    const changes = audit!.changes as Array<{ field: string; old: unknown; new: unknown }>;
    const pairing = changes.find((c) => c.field === 'pairedWithVisitId');
    expect(pairing).toEqual({
      field: 'pairedWithVisitId',
      old: null,
      new: pairedWithVisitId,
    });

    // DB row carries the FK.
    const row = await prisma.visit.findUnique({ where: { id: entry.id } });
    expect(row?.pairedWithVisitId).toBe(pairedWithVisitId);
  });

  it('POST /walkin rejects when no scheduled visit matches the pairing id', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const res = await req()
      .post('/api/visits/walkin')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        patientId,
        pairedWithVisitId: '00000000-0000-0000-0000-000000000000',
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      'Termini nuk u gjet ose nuk është për pacient pa termin',
    );
    expect(res.body.reason).toBe('walkin_pairing_invalid');
  });

  it('POST /walkin rejects pairing to a completed visit (status finalized)', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const scheduled = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '11:30', durationMinutes: 15 });
    expect(scheduled.status).toBe(201);
    const id: string = scheduled.body.entry.id;

    // March it to completed via the legal lifecycle path.
    for (const status of ['arrived', 'in_progress', 'completed'] as const) {
      await req()
        .patch(`/api/visits/${id}/status`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ status })
        .expect(200);
    }

    const res = await req()
      .post('/api/visits/walkin')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, pairedWithVisitId: id });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('walkin_pairing_invalid');
  });

  it('POST /walkin rejects pairing to another walk-in (must be a booking)', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const scheduled = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '12:30', durationMinutes: 15 });
    const pairedWithVisitId: string = scheduled.body.entry.id;
    const firstWalkin = await req()
      .post('/api/visits/walkin')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, pairedWithVisitId });
    expect(firstWalkin.status).toBe(201);

    // Trying to pair a new walk-in to the existing walk-in must fail.
    const res = await req()
      .post('/api/visits/walkin')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, pairedWithVisitId: firstWalkin.body.entry.id });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('walkin_pairing_invalid');
  });

  // -----------------------------------------------------------------------
  // 7. Stats endpoint
  // -----------------------------------------------------------------------

  it('stats counts walk-ins and scheduled separately, and aggregates payments', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    // Walk-ins must pair to a scheduled visit (CLAUDE.md §13). Book
    // one for today first, then create the walk-in paired against it.
    const todayDate = nextOpenDate();
    const scheduled = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date: todayDate, time: '15:00', durationMinutes: 15 });
    expect(scheduled.status).toBe(201);
    const todayIso = await req()
      .post('/api/visits/walkin')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, pairedWithVisitId: scheduled.body.entry.id });
    expect(todayIso.status).toBe(201);
    const today = todayIso.body.entry.arrivedAt.slice(0, 10);

    // Insert a completed clinical visit anchored to the same local day.
    const creator = await prisma.user.findFirstOrThrow({ where: { clinicId } });
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${today}T00:00:00Z`),
        scheduledFor: new Date(`${today}T08:00:00Z`),
        durationMinutes: 15,
        isWalkIn: false,
        status: 'completed',
        paymentCode: 'A',
        complaint: 'kontroll',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });

    const res = await req()
      .get(`/api/visits/calendar/stats?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.walkIn).toBe(1);
    expect(res.body.scheduled + res.body.completed + res.body.arrived).toBeGreaterThanOrEqual(2);
    // Receptionist sees the aggregate; A is 1500 cents in the seed.
    expect(typeof res.body.paymentTotalCents).toBe('number');
    // Slice F — the standalone counter ships on every stats response;
    // no standalone seeded here so the count is 0.
    expect(res.body.standaloneCount).toBe(0);
  });

  // Slice F — a completed standalone visit (no scheduled_for, no
  // is_walk_in) must contribute to the receptionist's `completed`
  // count and `paymentTotalCents`, matching the doctor's dashboard.
  // Pre-Slice F the anchor-based query silently dropped this row.
  it('stats: completed standalone visits contribute to completed + paymentTotalCents', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const creator = await prisma.user.findFirstOrThrow({ where: { clinicId } });
    const today = todayBelgradeIso();
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${today}T00:00:00Z`),
        // Standalone shape — neither anchor column set.
        scheduledFor: null,
        arrivedAt: null,
        isWalkIn: false,
        status: 'completed',
        paymentCode: 'A',
        complaint: 'kontroll i shkurtër',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });

    const res = await req()
      .get(`/api/visits/calendar/stats?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.standaloneCount).toBe(1);
    expect(res.body.completed).toBe(1);
    // Seed config: A = 1500 cents. The standalone visit pays full
    // money into the receptionist's day total now.
    expect(res.body.paymentTotalCents).toBe(1500);
  });

  // Slice F lock — receptionist stats and doctor dashboard must agree
  // on `completed` count and revenue by construction. Both endpoints
  // hit the same DB; if they ever drift again (different filters,
  // different anchors) this test catches it.
  it('stats: receptionist totals match doctor dashboard for the same day', async () => {
    const doctorCookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const recCookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const creator = await prisma.user.findFirstOrThrow({ where: { clinicId } });
    const today = todayBelgradeIso();

    // Seed a mix: one completed scheduled, one completed standalone,
    // one completed walk-in. All three feed both endpoints; the totals
    // must match.
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${today}T00:00:00Z`),
        scheduledFor: new Date(`${today}T08:00:00Z`),
        durationMinutes: 15,
        isWalkIn: false,
        status: 'completed',
        paymentCode: 'A',
        complaint: 'kontroll',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${today}T00:00:00Z`),
        scheduledFor: null,
        arrivedAt: null,
        isWalkIn: false,
        status: 'completed',
        paymentCode: 'B',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });
    const pair = await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${today}T00:00:00Z`),
        scheduledFor: new Date(`${today}T09:00:00Z`),
        durationMinutes: 15,
        isWalkIn: false,
        status: 'in_progress',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${today}T00:00:00Z`),
        arrivedAt: new Date(`${today}T09:30:00Z`),
        isWalkIn: true,
        durationMinutes: 5,
        status: 'completed',
        paymentCode: 'C',
        pairedWithVisitId: pair.id,
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });

    const recRes = await req()
      .get(`/api/visits/calendar/stats?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', recCookie);
    expect(recRes.status).toBe(200);

    const docRes = await req()
      .get(`/api/doctor/dashboard?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', doctorCookie);
    expect(docRes.status).toBe(200);

    expect(recRes.body.completed).toBe(docRes.body.stats.visitsCompleted);
    expect(recRes.body.paymentTotalCents).toBe(docRes.body.stats.paymentsCents);
  });

  // Cross-view parity lock (PR 2 of the doctor/receptionist alignment
  // work). The doctor's dashboard `stats.appointmentsTotal` must match
  // the receptionist's `/calendar/stats.total` by construction — both
  // use the same clinical-scope query `visit_date=today AND
  // deleted_at IS NULL`. Pre-PR-2 the dashboard's count was calendar-
  // scope and silently excluded standalones, so doctor's "10" disagreed
  // with receptionist's "15" any time a standalone existed.
  //
  // This seed exercises every shape across multiple statuses; if either
  // side ever drops or double-counts a shape, this test breaks.
  it('stats: doctor appointmentsTotal matches receptionist total across all visit shapes', async () => {
    const doctorCookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const recCookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const creator = await prisma.user.findFirstOrThrow({ where: { clinicId } });
    const today = todayBelgradeIso();
    const todayDate = new Date(`${today}T00:00:00Z`);
    const at = (hhmm: string): Date => new Date(`${today}T${hhmm}:00Z`);

    // Scheduled bookings — varied statuses.
    for (const [hhmm, status, code] of [
      ['07:00', 'completed', 'A'],
      ['07:30', 'completed', 'B'],
      ['08:00', 'completed', 'A'],
      ['08:30', 'in_progress', null],
      ['09:00', 'scheduled', null],
      ['09:30', 'scheduled', null],
      ['10:00', 'no_show', null],
      ['10:30', 'no_show', null],
    ] as const) {
      await prisma.visit.create({
        data: {
          clinicId,
          patientId,
          visitDate: todayDate,
          scheduledFor: at(hhmm),
          durationMinutes: 15,
          isWalkIn: false,
          status,
          paymentCode: code,
          createdBy: creator.id,
          updatedBy: creator.id,
        },
      });
    }

    // Walk-ins — one completed (with payment), one still in progress.
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: todayDate,
        arrivedAt: at('11:00'),
        isWalkIn: true,
        durationMinutes: 5,
        status: 'completed',
        paymentCode: 'B',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });
    await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: todayDate,
        arrivedAt: at('11:30'),
        isWalkIn: true,
        durationMinutes: 5,
        status: 'in_progress',
        createdBy: creator.id,
        updatedBy: creator.id,
      },
    });

    // Standalones — the shape that previously caused divergence. One
    // completed with payment (must contribute to revenue + completed
    // counts on both sides), one in_progress (must contribute to total
    // on both sides), one no_show (must contribute to total on both
    // sides as a terminal "didn't happen" row).
    for (const [status, code] of [
      ['completed', 'A'],
      ['in_progress', null],
      ['no_show', null],
    ] as const) {
      await prisma.visit.create({
        data: {
          clinicId,
          patientId,
          visitDate: todayDate,
          scheduledFor: null,
          arrivedAt: null,
          isWalkIn: false,
          status,
          paymentCode: code,
          createdBy: creator.id,
          updatedBy: creator.id,
        },
      });
    }

    const recRes = await req()
      .get(`/api/visits/calendar/stats?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', recCookie);
    expect(recRes.status).toBe(200);

    const docRes = await req()
      .get(`/api/doctor/dashboard?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', doctorCookie);
    expect(docRes.status).toBe(200);

    // Ground truth: count all non-deleted visits on today's local
    // date directly from Prisma so the parity assertions can't both
    // be wrong in the same way. The beforeEach wipes visits for this
    // clinic, so dbTotal is exactly what was seeded above:
    // 8 scheduled + 2 walk-in + 3 standalone = 13.
    const dbTotal = await prisma.visit.count({
      where: { clinicId, deletedAt: null, visitDate: todayDate },
    });
    expect(dbTotal).toBe(13);

    // Receptionist and doctor must agree with the DB.
    expect(recRes.body.total).toBe(dbTotal);
    expect(docRes.body.stats.appointmentsTotal).toBe(dbTotal);
    expect(docRes.body.stats.appointmentsTotal).toBe(recRes.body.total);

    // Completed parity: 3 scheduled + 1 walk-in + 1 standalone = 5.
    expect(recRes.body.completed).toBe(5);
    expect(docRes.body.stats.visitsCompleted).toBe(5);
    expect(docRes.body.stats.appointmentsCompleted).toBe(5);
    expect(docRes.body.stats.appointmentsCompleted).toBe(recRes.body.completed);

    // Revenue parity (whatever the seed payment-code values resolve
    // to in this clinic, both views must report the same number).
    expect(docRes.body.stats.paymentsCents).toBe(recRes.body.paymentTotalCents);

    // The Terminet panel list is still calendar-anchored — the count
    // changed scope but the row contents did not. 8 scheduled + 2
    // walk-ins = 10 calendar-anchored rows surface in `appointments[]`;
    // the 3 standalones do not.
    expect(docRes.body.appointments.length).toBe(10);

    // Cross-view "në pritje" parity (the in_progress+waiting chip fix).
    // Both views collapse scheduled+arrived into a single "waiting"
    // count: receptionist reads stats.scheduled + stats.arrived;
    // doctor derives it by filtering `appointments[]` by status. They
    // must agree row-for-row over the calendar-scope rows; standalones
    // never carry scheduled/arrived in practice, so the clinical vs.
    // calendar scope difference is moot here.
    const recWaiting = recRes.body.scheduled + recRes.body.arrived;
    const docWaiting = (docRes.body.appointments as Array<{ status: string }>)
      .filter((a) => a.status === 'scheduled' || a.status === 'arrived').length;
    // Seed: 2 scheduled bookings stay 'scheduled', 0 arrived bookings,
    // 0 walk-ins at 'arrived' → 2 + 0 = 2.
    expect(recWaiting).toBe(2);
    expect(docWaiting).toBe(2);
    expect(recWaiting).toBe(docWaiting);

    // In-progress parity: receptionist surfaces the count as its own
    // chip ("X në vijim"); doctor derives the same count from
    // `appointments[]`. 1 scheduled-booking + 1 walk-in + 1 standalone
    // = 3 in_progress total; receptionist sees all 3 (clinical scope),
    // doctor sees 2 from appointments (calendar scope — standalones
    // don't appear in the appointment list).
    expect(recRes.body.inProgress).toBe(3);
    const docInProgressFromAppts = (
      docRes.body.appointments as Array<{ status: string }>
    ).filter((a) => a.status === 'in_progress').length;
    expect(docInProgressFromAppts).toBe(2);

    // Chip math invariant — receptionist's stat-foot chips must sum to
    // total. The chip set is:
    //   completed + inProgress + (scheduled + arrived) + noShow.
    // Every seeded row falls into exactly one bucket, so the chips
    // partition the day.
    const chipSum =
      recRes.body.completed +
      recRes.body.inProgress +
      recRes.body.scheduled +
      recRes.body.arrived +
      recRes.body.noShow;
    expect(chipSum).toBe(recRes.body.total);
    // 2 scheduled-as-no_show + 1 standalone-as-no_show = 3.
    expect(recRes.body.noShow).toBe(3);
  });

  // Walk-ins-only edge case for the "në pritje" collapse. When the day
  // is entirely walk-ins sitting at status='arrived' (the scenario
  // that broke the original chip — 5 walk-ins were invisible because
  // the chip read stats.scheduled, missing arrived), the receptionist's
  // combined waiting count must equal the walk-in count, not zero.
  it('stats: walk-ins-only day reports waiting = arrived count (cross-view)', async () => {
    const doctorCookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const recCookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const creator = await prisma.user.findFirstOrThrow({ where: { clinicId } });
    const today = todayBelgradeIso();
    const todayDate = new Date(`${today}T00:00:00Z`);
    const at = (hhmm: string): Date => new Date(`${today}T${hhmm}:00Z`);

    for (const hhmm of ['09:00', '09:15', '09:30', '09:45', '10:00']) {
      await prisma.visit.create({
        data: {
          clinicId,
          patientId,
          visitDate: todayDate,
          arrivedAt: at(hhmm),
          isWalkIn: true,
          durationMinutes: 5,
          status: 'arrived',
          createdBy: creator.id,
          updatedBy: creator.id,
        },
      });
    }

    const recRes = await req()
      .get(`/api/visits/calendar/stats?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', recCookie);
    expect(recRes.status).toBe(200);
    expect(recRes.body.total).toBe(5);
    expect(recRes.body.scheduled).toBe(0);
    expect(recRes.body.arrived).toBe(5);
    // The fix: combined waiting (scheduled + arrived) must be 5.
    // Pre-fix the UI read only `scheduled` and showed 0.
    expect(recRes.body.scheduled + recRes.body.arrived).toBe(5);

    const docRes = await req()
      .get(`/api/doctor/dashboard?date=${today}`)
      .set('host', TENANT_HOST)
      .set('Cookie', doctorCookie);
    expect(docRes.status).toBe(200);
    expect(docRes.body.stats.appointmentsTotal).toBe(5);
    const docWaiting = (docRes.body.appointments as Array<{ status: string }>)
      .filter((a) => a.status === 'scheduled' || a.status === 'arrived').length;
    expect(docWaiting).toBe(5);
    expect(docWaiting).toBe(recRes.body.scheduled + recRes.body.arrived);
  });

  // Today's Belgrade-local date string. Matches the canonical helper
  // used in service code (apps/api/src/common/datetime.ts §
  // localDateToday) so seeded rows align with what the endpoints
  // query.
  function todayBelgradeIso(): string {
    return new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Belgrade',
    });
  }

  // -----------------------------------------------------------------------
  // 8. Soft delete + restore round-trip
  // -----------------------------------------------------------------------

  it('soft-delete + restore round-trips with a 30s window', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '11:00', durationMinutes: 15 });
    const id = create.body.entry.id;

    const del = await req()
      .delete(`/api/visits/calendar/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(del.status).toBe(200);
    expect(typeof del.body.restorableUntil).toBe('string');

    const list1 = await req()
      .get(`/api/visits/calendar?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(list1.body.entries).toHaveLength(0);

    const restore = await req()
      .post(`/api/visits/calendar/${id}/restore`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(restore.status).toBe(200);

    const list2 = await req()
      .get(`/api/visits/calendar?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(list2.body.entries).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // 9. Delete refused on rows with clinical data
  // -----------------------------------------------------------------------

  it('DELETE refuses 403 when the row carries clinical data', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '11:30', durationMinutes: 15 });
    const id = create.body.entry.id;

    // Backdoor in some clinical content (the doctor's auto-save would
    // normally do this; we shortcut for the test).
    await prisma.visit.update({
      where: { id },
      data: { complaint: 'temperaturë', paymentCode: 'A' },
    });

    const del = await req()
      .delete(`/api/visits/calendar/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(del.status).toBe(403);
    expect(del.body.reason).toBe('has_clinical_data');
    expect(typeof del.body.message).toBe('string');
    expect(del.body.message).toMatch(/Pastro përmes formularit të mjekut/);
  });

  // -----------------------------------------------------------------------
  // 10. Receptionist response shape redacts paymentCode
  // -----------------------------------------------------------------------

  it('receptionist GET response redacts paymentCode but doctor sees it', async () => {
    const recCookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const docCookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', recCookie)
      .send({ patientId, date, time: '12:00', durationMinutes: 15 });
    const id = create.body.entry.id;
    // Doctor stamps a payment code (simulating a completed visit).
    await prisma.visit.update({
      where: { id },
      data: { status: 'completed', paymentCode: 'A' },
    });

    const recList = await req()
      .get(`/api/visits/calendar?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', recCookie);
    const recEntry = recList.body.entries.find(
      (e: { id: string }) => e.id === id,
    );
    expect(recEntry).toBeDefined();
    expect(recEntry.paymentCode).toBeNull();

    const docList = await req()
      .get(`/api/visits/calendar?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', docCookie);
    const docEntry = docList.body.entries.find(
      (e: { id: string }) => e.id === id,
    );
    expect(docEntry).toBeDefined();
    expect(docEntry.paymentCode).toBe('A');
  });

  // -----------------------------------------------------------------------
  // 11. RLS isolation
  // -----------------------------------------------------------------------

  it('RLS isolation: clinic A cookie cannot reach clinic B data', async () => {
    const cookieA = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    let userB = await prisma.user.findFirst({ where: { clinicId: secondClinicId } });
    if (!userB) {
      userB = await prisma.user.create({
        data: {
          clinicId: secondClinicId,
          email: 'second-rls@second-calendar.health',
          passwordHash: 'x',
          roles: ['receptionist'],
          firstName: 'X',
          lastName: 'Y',
        },
      });
    }
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
    const visitB = await prisma.visit.create({
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
      .get(`/api/visits/calendar?from=${date}&to=${date}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookieA);
    expect(res.status).toBe(200);
    const ids = (res.body.entries as Array<{ id: string }>).map((e) => e.id);
    expect(ids).not.toContain(visitB.id);
  });

  // -----------------------------------------------------------------------
  // 11b. findNextUnpairedScheduledVisit (doctor-walkin pairing helper)
  // -----------------------------------------------------------------------
  //
  // The helper is exercised end-to-end by the doctor-new endpoint in
  // visits.integration.spec.ts, but these direct cases pin the empty/
  // exhausted return shapes that the controller path never reaches.

  it('findNextUnpairedScheduledVisit returns null when no scheduled visits exist today', async () => {
    const todayIso = new Date().toLocaleDateString('sv-SE', {
      timeZone: 'Europe/Belgrade',
    });
    const svc = module.get(VisitsCalendarService);
    const result = await svc.findNextUnpairedScheduledVisit(clinicId, todayIso);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 12. Audit-shape invariant
  // -----------------------------------------------------------------------

  it('calendar mutations write audit rows with resource_type=visit and action=visit.*', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const date = nextOpenDate();
    const create = await req()
      .post('/api/visits/scheduled')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, date, time: '13:30', durationMinutes: 15 });
    const id = create.body.entry.id;

    await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'arrived' });

    await req()
      .delete(`/api/visits/calendar/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);

    const rows = await prisma.auditLog.findMany({
      where: { clinicId, resourceId: id },
    });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) {
      expect(r.resourceType).toBe('visit');
      expect(r.action).toMatch(/^visit\./);
    }
    // No stray legacy resource_type='appointment' rows post-Phase 2a.
    const legacy = await prisma.auditLog.count({
      where: { clinicId, resourceType: 'appointment' },
    });
    expect(legacy).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 13. Receptionist edit-lock (daily-report integrity)
  // -----------------------------------------------------------------------
  //
  // The lock rule is "past day OR today+completed" for receptionist-only
  // sessions. The seed doctor user carries BOTH `doctor` and
  // `clinic_admin` roles — logging in as them exercises the bypass path
  // for both privileges in one test. Locked rows can't be created via
  // the public API (the date validation prevents past creation), so the
  // setup directly inserts via Prisma with the desired visit_date /
  // scheduledFor / status / arrivedAt fields.

  /**
   * Insert a visit row directly via Prisma for lock setup. Bypasses
   * the controller's date validation so tests can plant rows on past
   * days and in any status.
   */
  async function createVisitRaw(opts: {
    visitDate: string; // YYYY-MM-DD (local)
    scheduledFor?: Date | null;
    arrivedAt?: Date | null;
    durationMinutes?: number;
    status: 'scheduled' | 'arrived' | 'in_progress' | 'completed' | 'no_show';
    isWalkIn?: boolean;
    deletedAt?: Date | null;
  }): Promise<string> {
    const seed = await prisma.user.findFirstOrThrow({
      where: { clinicId, roles: { has: 'doctor' } },
    });
    const row = await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date(`${opts.visitDate}T00:00:00Z`),
        scheduledFor: opts.scheduledFor ?? null,
        durationMinutes: opts.durationMinutes ?? (opts.isWalkIn ? 5 : 15),
        isWalkIn: opts.isWalkIn ?? false,
        arrivedAt: opts.arrivedAt ?? null,
        status: opts.status,
        deletedAt: opts.deletedAt ?? null,
        createdBy: seed.id,
        updatedBy: seed.id,
      },
    });
    return row.id;
  }

  function yesterdayIso(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  function todayIso(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }

  it('lock: receptionist PATCH /:id/status on yesterday + scheduled → 403 locked + audit', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const yIso = yesterdayIso();
    const id = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: new Date(`${yIso}T10:00:00Z`),
      status: 'scheduled',
    });

    const res = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'no_show' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('locked');
    expect(typeof res.body.message).toBe('string');

    const blocked = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'visit.edit_blocked', resourceId: id },
    });
    expect(blocked).toBeDefined();
    const changes = blocked!.changes as Array<{ field: string; new: unknown }>;
    const byField = Object.fromEntries(changes.map((c) => [c.field, c.new]));
    expect(byField['reason']).toBe('locked');
    expect(byField['operation']).toBe('status_change');
    expect(byField['actorRole']).toBe('receptionist');
    expect(byField['visitStatus']).toBe('scheduled');
    expect(byField['visitDate']).toBe(yIso);
  });

  it('lock: receptionist PATCH /:id/status on today + completed → 403', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const tIso = todayIso();
    const id = await createVisitRaw({
      visitDate: tIso,
      scheduledFor: new Date(`${tIso}T10:00:00Z`),
      status: 'completed',
    });

    const res = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'arrived' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('locked');
  });

  it('lock: receptionist PATCH /:id/status on today + scheduled → 200', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const tIso = todayIso();
    const id = await createVisitRaw({
      visitDate: tIso,
      scheduledFor: new Date(`${tIso}T10:00:00Z`),
      status: 'scheduled',
    });

    const res = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'arrived' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('arrived');
  });

  it('lock: receptionist PATCH /:id/scheduling on yesterday → 403', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const yIso = yesterdayIso();
    const id = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: new Date(`${yIso}T10:00:00Z`),
      status: 'scheduled',
    });

    const res = await req()
      .patch(`/api/visits/${id}/scheduling`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ time: '11:00' });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('locked');
  });

  it('lock: receptionist DELETE on yesterday → 403', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const yIso = yesterdayIso();
    const id = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: new Date(`${yIso}T10:00:00Z`),
      status: 'scheduled',
    });

    const res = await req()
      .delete(`/api/visits/calendar/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('locked');
  });

  it('lock: receptionist POST /restore on a visit deleted yesterday → 403', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const yIso = yesterdayIso();
    const id = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: new Date(`${yIso}T10:00:00Z`),
      status: 'scheduled',
      deletedAt: new Date(`${yIso}T11:00:00Z`),
    });

    const res = await req()
      .post(`/api/visits/calendar/${id}/restore`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('locked');
  });

  it('lock: receptionist POST /walkin with locked pairing target (yesterday + scheduled) → 400 + locked audit on the target', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const yIso = yesterdayIso();
    const targetId = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: new Date(`${yIso}T10:00:00Z`),
      status: 'scheduled',
    });

    const res = await req()
      .post('/api/visits/walkin')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ patientId, pairedWithVisitId: targetId });
    expect(res.status).toBe(400);
    expect(res.body.reason).toBe('locked');

    const blocked = await prisma.auditLog.findFirst({
      where: { clinicId, action: 'visit.edit_blocked', resourceId: targetId },
    });
    expect(blocked).toBeDefined();
    const changes = blocked!.changes as Array<{ field: string; new: unknown }>;
    const byField = Object.fromEntries(changes.map((c) => [c.field, c.new]));
    expect(byField['operation']).toBe('walkin_pairing');
  });

  it('lock: doctor+clinic_admin bypasses the lock — PATCH /:id/status on yesterday → 200', async () => {
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const yIso = yesterdayIso();
    const id = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: new Date(`${yIso}T10:00:00Z`),
      status: 'scheduled',
    });

    const res = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'no_show' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('no_show');

    // No `visit.edit_blocked` audit row for the doctor — only the
    // normal status_changed entry.
    const blocked = await prisma.auditLog.count({
      where: { clinicId, action: 'visit.edit_blocked', resourceId: id },
    });
    expect(blocked).toBe(0);
  });

  it('lock: doctor+clinic_admin bypasses the lock — DELETE on yesterday → 200', async () => {
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const yIso = yesterdayIso();
    const id = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: new Date(`${yIso}T10:00:00Z`),
      status: 'scheduled',
    });

    const res = await req()
      .delete(`/api/visits/calendar/${id}`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  // -----------------------------------------------------------------------
  // PATCH /:id/status on a standalone doctor visit
  //
  // Doctor-only "Vizitë e re" rows have `scheduled_for=null` and
  // `isWalkIn=false`, so they sit outside the calendar-visible
  // predicate. Pre-fix, the status endpoint 404'd on these rows and
  // both the chart's "Përfundo vizitën" and the home dashboard's
  // "Vizita të hapura" quick-complete were dead ends. Clinical roles
  // now skip the calendar-visible filter on this single endpoint.
  // -----------------------------------------------------------------------

  it('PATCH /:id/status — doctor completes a standalone in_progress visit (no scheduledFor, no walk-in)', async () => {
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const tIso = todayIso();
    const id = await createVisitRaw({
      visitDate: tIso,
      scheduledFor: null,
      isWalkIn: false,
      status: 'in_progress',
    });

    const res = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('completed');

    const row = await prisma.visit.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('completed');
  });

  it('PATCH /:id/status — doctor completes a standalone visit from a prior day (Vizita të hapura backlog)', async () => {
    const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
    const yIso = yesterdayIso();
    const id = await createVisitRaw({
      visitDate: yIso,
      scheduledFor: null,
      isWalkIn: false,
      status: 'in_progress',
    });

    const res = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'completed' });
    expect(res.status).toBe(200);
    expect(res.body.entry.status).toBe('completed');
  });

  it('PATCH /:id/status — receptionist still 404s on a standalone doctor visit (visibility unchanged)', async () => {
    const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
    const tIso = todayIso();
    const id = await createVisitRaw({
      visitDate: tIso,
      scheduledFor: null,
      isWalkIn: false,
      status: 'in_progress',
    });

    const res = await req()
      .patch(`/api/visits/${id}/status`)
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ status: 'completed' });
    // Calendar-visible filter still applies for receptionist sessions
    // — the standalone doctor visit isn't in her surface, and the
    // server refuses to acknowledge it. 404 ('Vizita nuk u gjet') is
    // the right shape: indistinguishable from "no such id", so it
    // doesn't leak the row's existence across the privacy boundary.
    expect(res.status).toBe(404);
  });

  // -----------------------------------------------------------------------
  // Helpers (mirror patients.integration.spec.ts)
  // -----------------------------------------------------------------------

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
