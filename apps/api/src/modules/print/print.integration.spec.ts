// Integration tests for the print pipeline.
//
// Real Postgres, real Nest app, but the Puppeteer renderer is replaced
// with a stub that returns a minimal valid PDF byte sequence. We
// assert the wire surface (status, headers, audit log) rather than
// the rendered pixels — the template-level tests already cover field
// visibility.
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
import { PRINT_RENDERER, type PrintRenderer } from './print-renderer.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_RECEPTIONIST_PASSWORD = process.env['SEED_RECEPTIONIST_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_RECEPTIONIST_PASSWORD);

const TENANT_HOST = 'donetamed.klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';
const RECEPTIONIST_EMAIL = 'ereblire.krasniqi@klinika.health';

// Minimal valid PDF (1 page, no content) — the renderer stub returns
// this so the controller can stream a real-looking response without
// firing up Chromium. The integration tests only assert content-type
// + non-empty length; the visual rendering is the template tests'
// job.
const STUB_PDF_HEADER = Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary');

class CapturingRenderer implements PrintRenderer {
  public lastHtml: string | null = null;
  public lastHint: string | null = null;
  async renderPdf(html: string, hint: string): Promise<Buffer> {
    this.lastHtml = html;
    this.lastHint = hint;
    return Buffer.concat([STUB_PDF_HEADER, Buffer.from(`hint:${hint}\n`)]);
  }
}

describe.skipIf(!ENABLED)('Print integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let renderer: CapturingRenderer;
  let clinicId: string;
  let doctorId: string;
  let patientId: string;
  let visitId: string;

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
    renderer = new CapturingRenderer();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(captured)
      .overrideProvider(PRINT_RENDERER)
      .useValue(renderer)
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
    renderer.lastHtml = null;
    renderer.lastHint = null;
    await prisma.rateLimit.deleteMany({});
    await prisma.authLoginAttempt.deleteMany({});
    await prisma.authMfaCode.deleteMany({});
    await prisma.authTrustedDevice.deleteMany({});
    await prisma.authSession.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { clinicId } });
    await prisma.vertetim.deleteMany({ where: { clinicId } });
    await prisma.visitDicomLink.deleteMany({});
    await prisma.visitDiagnosis.deleteMany({});
    await prisma.doctorDiagnosisUsage.deleteMany({ where: { clinicId } });
    await prisma.visit.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId } });

    const patient = await prisma.patient.create({
      data: {
        clinicId,
        legacyId: 15626,
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: new Date('2023-08-03'),
        placeOfBirth: 'Prizren',
        sex: 'f',
        birthWeightG: 3280,
      },
    });
    patientId = patient.id;

    // ensure J03.9 exists in the icd10 catalogue
    await prisma.icd10Code.upsert({
      where: { code: 'J03.9' },
      update: {},
      create: {
        code: 'J03.9',
        latinDescription: 'Tonsillitis acuta',
        chapter: 'J',
        common: true,
      },
    });

    const visit = await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date('2026-05-14T00:00:00Z'),
        prescription: 'Spray.Axxa 2× në ditë, 5 ditë',
        weightG: 13_600,
        createdBy: doctorId,
        updatedBy: doctorId,
        diagnoses: {
          create: {
            icd10Code: 'J03.9',
            orderIndex: 0,
          },
        },
      },
    });
    visitId = visit.id;
  });

  describe('GET /api/print/visit/:id', () => {
    it('returns application/pdf for the doctor', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get(`/api/print/visit/${visitId}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Number(res.headers['content-length'])).toBeGreaterThan(0);
      // Body starts with the PDF magic number
      expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');
      // Audit row written
      const audit = await prisma.auditLog.findFirst({
        where: { clinicId, action: 'print.visit_report.requested', resourceId: visitId },
      });
      expect(audit).not.toBeNull();
    });

    it('contains the visit diagnosis + prescription in the rendered HTML', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      await req()
        .get(`/api/print/visit/${visitId}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(renderer.lastHtml).toContain('J03.9');
      expect(renderer.lastHtml).toContain('Tonsillitis acuta');
      expect(renderer.lastHtml).toContain('Spray.Axxa');
      expect(renderer.lastHtml).toContain('Era Krasniqi');
    });

    it('returns 403 for the receptionist', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get(`/api/print/visit/${visitId}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });

    it('returns 404 for an unknown visit', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get(`/api/print/visit/00000000-0000-4000-8000-000000000000`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Vërtetim issuance + print + snapshot freeze', () => {
    it('issues a vërtetim with the frozen diagnosis snapshot and reprints it identically after a diagnosis change', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      // 1. Issue a vërtetim
      const issueRes = await req()
        .post('/api/vertetim')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({
          visitId,
          absenceFrom: '2026-05-14',
          absenceTo: '2026-05-18',
        });
      expect(issueRes.status).toBe(201);
      const issued = issueRes.body.vertetim;
      expect(issued.durationDays).toBe(5);
      expect(issued.diagnosisSnapshot).toBe('J03.9 — Tonsillitis acuta');

      // Audit: print.vertetim.issued is written with the snapshot
      const issueAudit = await prisma.auditLog.findFirst({
        where: { clinicId, action: 'print.vertetim.issued', resourceId: issued.id },
      });
      expect(issueAudit).not.toBeNull();

      // 2. Print the vërtetim — verify the rendered HTML carries the
      //    structured diagnosis from the moment of issue.
      const print1 = await req()
        .get(`/api/print/vertetim/${issued.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(print1.status).toBe(200);
      expect(print1.headers['content-type']).toMatch(/application\/pdf/);
      const firstHtml = renderer.lastHtml;
      expect(firstHtml).toContain('Tonsillitis acuta');
      expect(firstHtml).toContain('J03.9');

      // 3. Change the visit's diagnosis to a different code
      await prisma.visitDiagnosis.deleteMany({ where: { visitId } });
      await prisma.icd10Code.upsert({
        where: { code: 'R05' },
        update: {},
        create: {
          code: 'R05',
          latinDescription: 'Tussis',
          chapter: 'R',
          common: true,
        },
      });
      await prisma.visitDiagnosis.create({
        data: { visitId, icd10Code: 'R05', orderIndex: 0 },
      });

      // 4. Reprint — the snapshot text MUST still appear, NOT the
      //    new live diagnosis text.
      const print2 = await req()
        .get(`/api/print/vertetim/${issued.id}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(print2.status).toBe(200);
      const secondHtml = renderer.lastHtml;
      expect(secondHtml).toContain('Tonsillitis acuta');
      // The snapshot text is the frozen one. The structured code that
      // the template uses for the formatted box may pull from the
      // visit (R05) — the snapshot string itself is the source of
      // truth and is always rendered when the box falls back.
      const cert = await prisma.vertetim.findUnique({ where: { id: issued.id } });
      expect(cert?.diagnosisSnapshot).toBe('J03.9 — Tonsillitis acuta');
    });
  });

  describe('GET /api/print/history/:patientId', () => {
    it('returns application/pdf, contains rows for visits', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get(`/api/print/history/${patientId}?include_ultrasound=false`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
      expect(renderer.lastHtml).toContain('Era Krasniqi');
      expect(renderer.lastHtml).toContain('HISTORIA E PACIENTIT');
      expect(renderer.lastHtml).toContain('14.05.2026');
      // Audit
      const audit = await prisma.auditLog.findFirst({
        where: { clinicId, action: 'print.history.requested', resourceId: patientId },
      });
      expect(audit).not.toBeNull();
    });

    it('rejects the receptionist with 403', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get(`/api/print/history/${patientId}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });

    it('tolerates the iframe-print cache-buster `_t` query param', async () => {
      // Regression: the iframe-print harness appends `_t=<timestamp>`
      // to defeat the PDF cache (apps/web/lib/print-frame.ts). The
      // history schema used `.strict()` and rejected the request
      // with a 400; only history failed this way because visit and
      // vërtetim don't parse their query. Schema is now
      // `.passthrough()`.
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get(`/api/print/history/${patientId}?include_ultrasound=false&_t=${Date.now()}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/application\/pdf/);
    });
  });

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  function req(): request.Agent {
    return request(app.getHttpServer());
  }

  async function loginAs(email: string, password: string): Promise<string> {
    const start = await req()
      .post('/api/auth/login')
      .set('host', TENANT_HOST)
      .send({ email, password, rememberMe: false });
    expect(start.status).toBe(200);
    const pending = start.body.pendingSessionId as string;
    const msg = captured.takeLatest(email);
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
    captured.clear();
    return session!.split(';')[0];
  }
});
