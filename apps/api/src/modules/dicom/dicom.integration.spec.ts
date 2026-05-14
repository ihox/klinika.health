// Integration tests for the DICOM bridge.
//
// Real Postgres, real Nest app, supertest at the HTTP layer. The
// OrthancClient is replaced with an in-memory stub keyed by Orthanc
// study/instance id — the bridge logic (auth scoping, audit, link
// idempotency) is exercised against real RLS / Prisma without
// needing a live Orthanc container.
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
import { OrthancClient, type OrthancFetchResult, type OrthancStudyMeta } from './orthanc.client';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_RECEPTIONIST_PASSWORD = process.env['SEED_RECEPTIONIST_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_RECEPTIONIST_PASSWORD);

const TENANT_HOST = 'donetamed.klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';
const RECEPTIONIST_EMAIL = 'ereblire.krasniqi@klinika.health';
const WEBHOOK_SECRET = 'test-webhook-secret';

/**
 * In-memory Orthanc — supports `getStudy`, `getInstance`,
 * `fetchPreview`, `fetchFullDicom`. Studies are seeded per test.
 */
class StubOrthancClient extends OrthancClient {
  private studies = new Map<string, OrthancStudyMeta>();
  private bytes = new Map<string, OrthancFetchResult>();

  constructor() {
    super({
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
      trace: () => undefined,
      fatal: () => undefined,
      setContext: () => undefined,
      assign: () => undefined,
    } as unknown as ConstructorParameters<typeof OrthancClient>[0]);
  }

  override isConfigured(): boolean {
    return true;
  }

  seed(study: OrthancStudyMeta): void {
    this.studies.set(study.ID, study);
    for (const inst of study.Instances) {
      this.bytes.set(inst, {
        buffer: Buffer.from(`fake-preview-${inst}`),
        contentType: 'image/png',
      });
    }
  }

  override async getStudy(orthancStudyId: string): Promise<OrthancStudyMeta | null> {
    return this.studies.get(orthancStudyId) ?? null;
  }

  override async listInstances(orthancStudyId: string): Promise<string[]> {
    return this.studies.get(orthancStudyId)?.Instances ?? [];
  }

  override async getInstance(
    instanceId: string,
  ): Promise<{ ParentStudy?: string } | null> {
    for (const [studyId, study] of this.studies) {
      if (study.Instances.includes(instanceId)) {
        return { ParentStudy: studyId };
      }
    }
    return null;
  }

  override async fetchPreview(instanceId: string): Promise<OrthancFetchResult | null> {
    return this.bytes.get(instanceId) ?? null;
  }

  override async fetchFullDicom(instanceId: string): Promise<OrthancFetchResult | null> {
    const raw = this.bytes.get(instanceId);
    if (!raw) return null;
    return { buffer: raw.buffer, contentType: 'application/dicom' };
  }

  override async getStorageBytes(): Promise<number | null> {
    return 1024 * 1024 * 50;
  }
}

describe.skipIf(!ENABLED)('DICOM bridge integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let orthanc: StubOrthancClient;
  let clinicId: string;
  let doctorId: string;
  let patientId: string;
  let visitId: string;

  beforeAll(async () => {
    process.env['ORTHANC_WEBHOOK_SECRET'] = WEBHOOK_SECRET;
    process.env['ORTHANC_URL'] = 'http://stubbed:8042';
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
    orthanc = new StubOrthancClient();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(captured)
      .overrideProvider(OrthancClient)
      .useValue(orthanc)
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
    delete process.env['ORTHANC_WEBHOOK_SECRET'];
    delete process.env['ORTHANC_URL'];
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
    await prisma.dicomStudy.deleteMany({ where: { clinicId } });
    await prisma.vertetim.deleteMany({ where: { clinicId } });
    await prisma.visitDiagnosis.deleteMany({});
    await prisma.visit.deleteMany({ where: { clinicId } });
    await prisma.patient.deleteMany({ where: { clinicId } });

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

    const visit = await prisma.visit.create({
      data: {
        clinicId,
        patientId,
        visitDate: new Date('2026-05-14T00:00:00Z'),
        createdBy: doctorId,
        updatedBy: doctorId,
      },
    });
    visitId = visit.id;

    // Reset stub state between tests by allocating a new stub. The
    // module-scoped override still points at the old instance, so we
    // mutate it in place.
    (orthanc as unknown as { studies: Map<string, unknown>; bytes: Map<string, unknown> })
      .studies.clear();
    (orthanc as unknown as { studies: Map<string, unknown>; bytes: Map<string, unknown> })
      .bytes.clear();
  });

  // -------------------------------------------------------------------------
  // Webhook → ingest
  // -------------------------------------------------------------------------

  describe('POST /api/dicom/internal/orthanc-event', () => {
    it('upserts a dicom_studies row when the secret matches', async () => {
      orthanc.seed({
        ID: 'orthanc-study-1',
        Instances: ['i1', 'i2'],
        Series: ['s1'],
        MainDicomTags: {
          StudyDate: '20260514',
          StudyTime: '094203',
          StudyDescription: 'Ultrasound Abdomen',
        },
        PatientMainDicomTags: { PatientName: 'Krasniqi^Era' },
      });
      const res = await req()
        .post('/api/dicom/internal/orthanc-event')
        .set('host', TENANT_HOST)
        .set('X-Klinika-Orthanc-Secret', WEBHOOK_SECRET)
        .send({ studyId: 'orthanc-study-1', instanceId: 'i1' });
      expect(res.status).toBe(204);

      const row = await prisma.dicomStudy.findFirstOrThrow({
        where: { clinicId, orthancStudyId: 'orthanc-study-1' },
      });
      expect(row.imageCount).toBe(2);
      expect(row.studyDescription).toBe('Ultrasound Abdomen');
      expect(row.patientNameDicom).toBe('Krasniqi^Era');
    });

    it('is idempotent — two events for the same study create one row', async () => {
      orthanc.seed({
        ID: 'orthanc-study-2',
        Instances: ['i1'],
        Series: ['s1'],
        MainDicomTags: { StudyDate: '20260514' },
      });
      await req()
        .post('/api/dicom/internal/orthanc-event')
        .set('host', TENANT_HOST)
        .set('X-Klinika-Orthanc-Secret', WEBHOOK_SECRET)
        .send({ studyId: 'orthanc-study-2' });
      await req()
        .post('/api/dicom/internal/orthanc-event')
        .set('host', TENANT_HOST)
        .set('X-Klinika-Orthanc-Secret', WEBHOOK_SECRET)
        .send({ studyId: 'orthanc-study-2' });
      const count = await prisma.dicomStudy.count({
        where: { clinicId, orthancStudyId: 'orthanc-study-2' },
      });
      expect(count).toBe(1);
    });

    it('rejects when the webhook secret is missing', async () => {
      const res = await req()
        .post('/api/dicom/internal/orthanc-event')
        .set('host', TENANT_HOST)
        .send({ studyId: 'orthanc-study-3' });
      expect(res.status).toBe(400);
    });

    it('rejects when the webhook secret is wrong', async () => {
      const res = await req()
        .post('/api/dicom/internal/orthanc-event')
        .set('host', TENANT_HOST)
        .set('X-Klinika-Orthanc-Secret', 'wrong')
        .send({ studyId: 'orthanc-study-3' });
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Picker — recent list
  // -------------------------------------------------------------------------

  describe('GET /api/dicom/recent', () => {
    it('returns the last 10 studies for a doctor', async () => {
      await prisma.dicomStudy.create({
        data: {
          clinicId,
          orthancStudyId: 'o-1',
          receivedAt: new Date('2026-05-14T10:00:00Z'),
          imageCount: 8,
          studyDescription: 'US Abdomen',
        },
      });
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get('/api/dicom/recent')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.studies).toHaveLength(1);
      expect(res.body.studies[0].orthancStudyId).toBe('o-1');
      expect(res.body.studies[0].imageCount).toBe(8);

      // Audit row written
      const audit = await prisma.auditLog.findFirst({
        where: { clinicId, action: 'dicom.study.viewed' },
      });
      expect(audit).not.toBeNull();
    });

    it('rejects the receptionist with 403', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get('/api/dicom/recent')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Link / unlink
  // -------------------------------------------------------------------------

  describe('Visit-link surface', () => {
    it('links a study to a visit and lists it back', async () => {
      const study = await prisma.dicomStudy.create({
        data: {
          clinicId,
          orthancStudyId: 'o-2',
          receivedAt: new Date('2026-05-14T10:00:00Z'),
          imageCount: 4,
        },
      });
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);

      const link = await req()
        .post(`/api/visits/${visitId}/dicom-links`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ dicomStudyId: study.id });
      expect(link.status).toBe(201);
      expect(link.body.link.dicomStudyId).toBe(study.id);

      const list = await req()
        .get(`/api/visits/${visitId}/dicom-links`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body.links).toHaveLength(1);

      const audit = await prisma.auditLog.findFirst({
        where: { clinicId, action: 'dicom.study.linked' },
      });
      expect(audit).not.toBeNull();
    });

    it('re-linking the same study is idempotent (single row)', async () => {
      const study = await prisma.dicomStudy.create({
        data: {
          clinicId,
          orthancStudyId: 'o-idem',
          receivedAt: new Date('2026-05-14T10:00:00Z'),
          imageCount: 4,
        },
      });
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      await req()
        .post(`/api/visits/${visitId}/dicom-links`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ dicomStudyId: study.id });
      await req()
        .post(`/api/visits/${visitId}/dicom-links`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ dicomStudyId: study.id });
      const count = await prisma.visitDicomLink.count({
        where: { visitId, dicomStudyId: study.id },
      });
      expect(count).toBe(1);
    });

    it('unlinks a study and writes an audit row', async () => {
      const study = await prisma.dicomStudy.create({
        data: {
          clinicId,
          orthancStudyId: 'o-3',
          receivedAt: new Date('2026-05-14T10:00:00Z'),
          imageCount: 4,
        },
      });
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const linkRes = await req()
        .post(`/api/visits/${visitId}/dicom-links`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ dicomStudyId: study.id });
      const linkId = linkRes.body.link.id as string;

      const del = await req()
        .delete(`/api/visits/${visitId}/dicom-links/${linkId}`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(del.status).toBe(204);

      const remaining = await prisma.visitDicomLink.count({ where: { visitId } });
      expect(remaining).toBe(0);

      const audit = await prisma.auditLog.findFirst({
        where: { clinicId, action: 'dicom.study.unlinked' },
      });
      expect(audit).not.toBeNull();
    });

    it('rejects the receptionist on POST link', async () => {
      const study = await prisma.dicomStudy.create({
        data: {
          clinicId,
          orthancStudyId: 'o-4',
          receivedAt: new Date('2026-05-14T10:00:00Z'),
          imageCount: 4,
        },
      });
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .post(`/api/visits/${visitId}/dicom-links`)
        .set('host', TENANT_HOST)
        .set('Cookie', cookie)
        .send({ dicomStudyId: study.id });
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Image proxy
  // -------------------------------------------------------------------------

  describe('GET /api/dicom/instances/:id/preview.png', () => {
    it('streams the rendered preview and writes an audit row', async () => {
      orthanc.seed({
        ID: 'o-prev',
        Instances: ['inst-1'],
        Series: ['s'],
        MainDicomTags: { StudyDate: '20260514' },
      });
      await prisma.dicomStudy.create({
        data: {
          clinicId,
          orthancStudyId: 'o-prev',
          receivedAt: new Date('2026-05-14T10:00:00Z'),
          imageCount: 1,
        },
      });
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get('/api/dicom/instances/inst-1/preview.png')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/image\/png/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.body.toString()).toBe('fake-preview-inst-1');

      const audit = await prisma.auditLog.findFirst({
        where: { clinicId, action: 'dicom.instance.viewed' },
      });
      expect(audit).not.toBeNull();
    });

    it('404s when the instance does not exist in Orthanc', async () => {
      const cookie = await loginAs(DOCTOR_EMAIL, SEED_DOCTOR_PASSWORD!);
      const res = await req()
        .get('/api/dicom/instances/ghost/preview.png')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
    });

    it('rejects the receptionist with 403', async () => {
      const cookie = await loginAs(RECEPTIONIST_EMAIL, SEED_RECEPTIONIST_PASSWORD!);
      const res = await req()
        .get('/api/dicom/instances/inst-1/preview.png')
        .set('host', TENANT_HOST)
        .set('Cookie', cookie);
      expect(res.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

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
