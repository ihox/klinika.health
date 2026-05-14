// Integration tests for the clinic-settings surface.
//
// Mirrors the auth/admin integration test pattern (real Postgres, real
// Nest app, supertest at the HTTP layer). Covers:
//
//   1. Logo upload (PNG and SVG) → readable through the proxy endpoint
//   2. Signature upload → stored encrypted at rest, decrypts via proxy
//   3. SMTP config update + test endpoint (with a stubbed transport so
//      tests don't dial out)
//   4. Audit log query + CSV export reflect the updates above
//
// Skips automatically when DATABASE_URL or seed passwords are unset.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { CapturingEmailSender, EMAIL_SENDER, EmailService } from '../email/email.service';
import { SESSION_COOKIE_NAME } from '../auth/session.service';
import { SmtpTestService } from './smtp-test.service';
import { ClinicStorageService } from './clinic-storage.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD);

const TENANT_HOST = 'donetamed.klinika.health';
const ADMIN_USER_EMAIL = 'admin.cilesimet@klinika.health';
const ADMIN_USER_PASSWORD = 'AdminSettings#2026!ZxQ';

const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle r="10"/></svg>';
const FAKE_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('signature-content', 'utf8'),
]);

describe.skipIf(!ENABLED)('Clinic settings integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;
  let storageRoot: string;
  let storage: ClinicStorageService;
  let clinicId: string;

  beforeAll(async () => {
    const apiDir = resolve(__dirname, '..', '..', '..');
    execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, stdio: 'inherit' });
    for (const f of ['001_rls_indexes_triggers.sql', '002_auth_rls.sql', '003_admin.sql']) {
      execSync(
        `psql "${DATABASE_URL ?? ''}" -v ON_ERROR_STOP=1 -f prisma/sql/${f}`,
        { cwd: apiDir, stdio: 'inherit' },
      );
    }
    execSync('pnpm seed', { cwd: apiDir, stdio: 'inherit' });

    storageRoot = mkdtempSync(join(tmpdir(), 'klinika-settings-it-'));
    process.env['STORAGE_ROOT'] = storageRoot;

    captured = new CapturingEmailSender();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(captured)
      .compile();
    app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { limit: '6mb' });
    app.useBodyParser('urlencoded', { limit: '6mb', extended: true });
    app.set('trust proxy', true);
    await app.init();
    prisma = app.get(PrismaService);
    storage = app.get(ClinicStorageService);
    app.get(EmailService).setSender(captured);

    // Stub the SMTP transport so the test endpoint doesn't dial out.
    app.get(SmtpTestService).useStubResult(async (params) => {
      if (params.host === 'fail.example.com') {
        return { ok: false, detail: 'Lidhja SMTP nuk u përgjigj.', reason: 'connect_failed' };
      }
      return { ok: true, detail: 'Lidhja u testua me sukses.' };
    });

    const clinic = await prisma.clinic.findFirstOrThrow({ where: { subdomain: 'donetamed' } });
    clinicId = clinic.id;
  });

  afterAll(async () => {
    await app?.close();
    if (storageRoot && existsSync(storageRoot)) {
      rmSync(storageRoot, { recursive: true, force: true });
    }
    delete process.env['STORAGE_ROOT'];
  });

  beforeEach(async () => {
    captured.clear();
    await prisma.rateLimit.deleteMany({});
    await prisma.authLoginAttempt.deleteMany({});
    await prisma.authMfaCode.deleteMany({});
    await prisma.authTrustedDevice.deleteMany({});
    await prisma.authSession.deleteMany({});
    await prisma.auditLog.deleteMany({ where: { clinicId } });
    // Reset SMTP config so each test starts on the platform default.
    await prisma.clinic.update({
      where: { id: clinicId },
      data: { smtpConfig: { set: null } },
    });
    // Ensure a clinic_admin we control exists (seed installs a doctor
    // and a receptionist; this slice's surface is admin-only).
    const passwords = app.get<unknown, never>(
      'PasswordService' as never,
    ) as { hash: (s: string) => Promise<string> } | undefined;
    const passwordHash = passwords
      ? await passwords.hash(ADMIN_USER_PASSWORD)
      : await import('argon2').then((m) =>
          m.hash(ADMIN_USER_PASSWORD, {
            type: m.argon2id,
            memoryCost: 19_456,
            timeCost: 2,
            parallelism: 1,
          }),
        );
    await prisma.user.upsert({
      where: { email: ADMIN_USER_EMAIL },
      update: { passwordHash, roles: ['clinic_admin'], isActive: true, deletedAt: null },
      create: {
        clinicId,
        email: ADMIN_USER_EMAIL,
        passwordHash,
        roles: ['clinic_admin'],
        firstName: 'Admin',
        lastName: 'Cilësimet',
        isActive: true,
      },
    });
    // Clean any storage left from previous tests.
    await storage.removeLogo(clinicId);
    await storage.removeClinicSignature(clinicId);
  });

  async function login(): Promise<string> {
    const start = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('host', TENANT_HOST)
      .send({ email: ADMIN_USER_EMAIL, password: ADMIN_USER_PASSWORD, rememberMe: false });
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('mfa_required');
    const pending = start.body.pendingSessionId as string;

    const email = captured.takeLatest(ADMIN_USER_EMAIL);
    expect(email).toBeDefined();
    const match = email!.text.match(/(\d{3}) (\d{3})/);
    const code = match ? `${match[1]}${match[2]}` : '';

    const verify = await request(app.getHttpServer())
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

  it('uploads a PNG logo, serves it back through the proxy', async () => {
    const cookie = await login();
    const upload = await request(app.getHttpServer())
      .post('/api/clinic/settings/branding/logo')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ contentType: 'image/png', dataBase64: FAKE_PNG.toString('base64') });
    expect(upload.status).toBe(200);
    expect(upload.body.branding.hasLogo).toBe(true);
    expect(upload.body.branding.logoContentType).toBe('image/png');

    const serve = await request(app.getHttpServer())
      .get('/api/clinic/logo')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(serve.status).toBe(200);
    expect(serve.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.compare(serve.body as Buffer, FAKE_PNG)).toBe(0);
  });

  it('uploads an SVG logo (sanitized) and rejects hostile SVGs', async () => {
    const cookie = await login();
    const goodSvg = await request(app.getHttpServer())
      .post('/api/clinic/settings/branding/logo')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        contentType: 'image/svg+xml',
        dataBase64: Buffer.from(VALID_SVG, 'utf8').toString('base64'),
      });
    expect(goodSvg.status).toBe(200);

    const hostile = await request(app.getHttpServer())
      .post('/api/clinic/settings/branding/logo')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        contentType: 'image/svg+xml',
        dataBase64: Buffer.from(
          '<svg xmlns="..."><script>alert(1)</script></svg>',
          'utf8',
        ).toString('base64'),
      });
    expect(hostile.status).toBe(400);
  });

  it('encrypts the clinic signature at rest', async () => {
    const cookie = await login();
    const upload = await request(app.getHttpServer())
      .post('/api/clinic/settings/branding/signature')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({ contentType: 'image/png', dataBase64: FAKE_PNG.toString('base64') });
    expect(upload.status).toBe(200);
    expect(upload.body.branding.hasSignature).toBe(true);

    const onDisk = readFileSync(storage.signaturePath(clinicId));
    // Plaintext PNG signature magic bytes must NOT appear at the head.
    expect(Buffer.compare(onDisk.subarray(0, 8), FAKE_PNG.subarray(0, 8))).not.toBe(0);

    // Proxy decrypts on read.
    const serve = await request(app.getHttpServer())
      .get('/api/clinic/signature')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(serve.status).toBe(200);
    expect(Buffer.compare(serve.body as Buffer, FAKE_PNG)).toBe(0);
  });

  it('saves SMTP config and runs the test endpoint via the stub', async () => {
    const cookie = await login();
    const save = await request(app.getHttpServer())
      .put('/api/clinic/settings/email')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        mode: 'smtp',
        host: 'smtp.gmail.com',
        port: 587,
        username: 'info@donetamed.health',
        password: 'app-password-xyz',
        fromName: 'DonetaMED',
        fromAddress: 'info@donetamed.health',
      });
    expect(save.status).toBe(200);
    expect(save.body.email.mode).toBe('smtp');
    expect(save.body.email.smtp.passwordSet).toBe(true);

    const ok = await request(app.getHttpServer())
      .post('/api/clinic/settings/email/test')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        mode: 'smtp',
        host: 'smtp.gmail.com',
        port: 587,
        username: 'info@donetamed.health',
        fromName: 'DonetaMED',
        fromAddress: 'info@donetamed.health',
        toEmail: 'taulant@klinika.health',
      });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);

    const fail = await request(app.getHttpServer())
      .post('/api/clinic/settings/email/test')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        mode: 'smtp',
        host: 'fail.example.com',
        port: 587,
        username: 'info@donetamed.health',
        password: 'app-password-xyz',
        fromName: 'DonetaMED',
        fromAddress: 'info@donetamed.health',
        toEmail: 'taulant@klinika.health',
      });
    expect(fail.status).toBe(200);
    expect(fail.body.ok).toBe(false);
    expect(fail.body.reason).toBe('connect_failed');

    // Audit log should have a settings.email.tested success row and a
    // settings.email.test_failed row.
    const audits = await prisma.auditLog.findMany({
      where: { clinicId, action: { in: ['settings.email.tested', 'settings.email.test_failed'] } },
    });
    expect(audits.map((a) => a.action).sort()).toEqual(
      ['settings.email.test_failed', 'settings.email.tested'].sort(),
    );
  });

  it('audit endpoint surfaces recent mutations and CSV export works', async () => {
    const cookie = await login();
    await request(app.getHttpServer())
      .put('/api/clinic/settings/general')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        name: 'DonetaMED — Updated',
        shortName: 'DONETA-MED',
        address: 'Rruga Adem Jashari, p.n.',
        city: 'Prizren',
        phones: ['045 83 00 83', '043 543 123'],
        email: 'info@donetamed.health',
      });

    const audit = await request(app.getHttpServer())
      .get('/api/clinic/audit')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(audit.status).toBe(200);
    expect(audit.body.rows.length).toBeGreaterThan(0);
    expect(audit.body.rows.find((r: { action: string }) => r.action === 'settings.general.updated')).toBeDefined();

    const csv = await request(app.getHttpServer())
      .get('/api/clinic/audit/export.csv')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('settings.general.updated');
  });

  it('non-admins cannot mutate clinic settings', async () => {
    // Seed includes a receptionist; create a session for them.
    const cookie = await loginAsReceptionist(app, captured);
    const res = await request(app.getHttpServer())
      .put('/api/clinic/settings/general')
      .set('host', TENANT_HOST)
      .set('Cookie', cookie)
      .send({
        name: 'Hack',
        shortName: 'HACK',
        address: 'x',
        city: 'y',
        phones: ['045 12 34 56'],
        email: 'x@y.com',
      });
    expect(res.status).toBe(403);
  });
});

async function loginAsReceptionist(
  app: NestExpressApplication,
  captured: CapturingEmailSender,
): Promise<string> {
  const email = 'ereblire.krasniqi@klinika.health';
  const start = await request(app.getHttpServer())
    .post('/api/auth/login')
    .set('host', TENANT_HOST)
    .send({
      email,
      password: process.env['SEED_RECEPTIONIST_PASSWORD'],
      rememberMe: false,
    });
  expect(start.status).toBe(200);
  const pending = start.body.pendingSessionId as string;
  const msg = captured.takeLatest(email);
  const match = msg!.text.match(/(\d{3}) (\d{3})/);
  const code = match ? `${match[1]}${match[2]}` : '';
  const verify = await request(app.getHttpServer())
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
