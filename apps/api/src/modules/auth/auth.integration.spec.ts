// Integration test: full auth flow against a real Postgres.
//
// Spins up the real Nest application (no per-test mocking of guards or
// services), hits the HTTP layer via supertest, and asserts that:
//
//   1. POST /api/auth/login with a known seeded user starts MFA.
//   2. Re-using the pending session + the issued code (read from the
//      capturing email sender) completes login.
//   3. A subsequent login from the same browser (carrying the
//      trusted-device cookie) skips MFA entirely.
//   4. Cross-tenant: a user from clinic A cannot log in on clinic B's
//      subdomain.
//   5. Rate limiting kicks in after the configured number of attempts.
//
// Skips automatically when DATABASE_URL is unset.

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import { CapturingEmailSender, EMAIL_SENDER, EmailService } from '../email/email.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SESSION_COOKIE_NAME } from './session.service';
import { TRUSTED_DEVICE_COOKIE_NAME } from './trusted-device.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD);

const DOCTOR_EMAIL = 'taulant.shala@donetamed.health';
const TENANT_HOST = 'donetamed.klinika.health';

describe.skipIf(!ENABLED)('Auth integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;

  beforeAll(async () => {
    const apiDir = resolve(__dirname, '..', '..', '..');
    execSync('pnpm exec prisma migrate deploy', { cwd: apiDir, stdio: 'inherit' });
    for (const f of ['001_rls_indexes_triggers.sql', '002_auth_rls.sql']) {
      execSync(
        `psql "${DATABASE_URL ?? ''}" -v ON_ERROR_STOP=1 -f prisma/migrations/manual/${f}`,
        { cwd: apiDir, stdio: 'inherit' },
      );
    }
    execSync('pnpm seed', { cwd: apiDir, stdio: 'inherit' });

    captured = new CapturingEmailSender();
    module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(captured)
      .compile();

    app = module.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', true);
    await app.init();

    prisma = app.get(PrismaService);

    // Swap the EmailService's sender too in case it was constructed
    // before the override applied (singleton timing).
    app.get(EmailService).setSender(captured);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    captured.clear();
    // Wipe rate-limit + login-attempt rows so each test starts fresh.
    await prisma.rateLimit.deleteMany({});
    await prisma.authLoginAttempt.deleteMany({});
    await prisma.authMfaCode.deleteMany({});
    await prisma.authTrustedDevice.deleteMany({});
    await prisma.authSession.deleteMany({});
  });

  function postLogin(body: Record<string, unknown>, opts: { host?: string; cookie?: string } = {}) {
    const req = request(app.getHttpServer())
      .post('/api/auth/login')
      .set('host', opts.host ?? TENANT_HOST)
      .set('Content-Type', 'application/json');
    if (opts.cookie) req.set('Cookie', opts.cookie);
    return req.send(body);
  }

  it('login → mfa_required, then verify completes session', async () => {
    const res = await postLogin({
      email: DOCTOR_EMAIL,
      password: SEED_DOCTOR_PASSWORD,
      rememberMe: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('mfa_required');
    expect(res.body.pendingSessionId).toBeDefined();
    expect(res.body.maskedEmail).toContain('@');

    const email = captured.takeLatest(DOCTOR_EMAIL);
    expect(email).toBeDefined();
    expect(email?.subject).toBe('Kodi i verifikimit · Klinika');
    const match = email?.text.match(/(\d{3}) (\d{3})/);
    const code = match ? `${match[1]}${match[2]}` : null;
    expect(code).toMatch(/^\d{6}$/);

    const verify = await request(app.getHttpServer())
      .post('/api/auth/mfa/verify')
      .set('host', TENANT_HOST)
      .send({ pendingSessionId: res.body.pendingSessionId, code, trustDevice: true });
    expect(verify.status).toBe(200);
    expect(verify.body.role).toBe('doctor');
    const setCookie = verify.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`))).toBe(true);
  });

  it('trusted-device cookie skips MFA on the next login', async () => {
    // First login: get MFA, complete, capture trusted cookie.
    const start = await postLogin({ email: DOCTOR_EMAIL, password: SEED_DOCTOR_PASSWORD, rememberMe: false });
    const email = captured.takeLatest(DOCTOR_EMAIL);
    const code = email?.text.match(/(\d{6})|(\d{3}) (\d{3})/);
    const codeStr = code ? (code[1] ?? `${code[2]}${code[3]}`) : '';
    const verify = await request(app.getHttpServer())
      .post('/api/auth/mfa/verify')
      .set('host', TENANT_HOST)
      .send({ pendingSessionId: start.body.pendingSessionId, code: codeStr, trustDevice: true });
    const cookies = Array.isArray(verify.headers['set-cookie'])
      ? verify.headers['set-cookie']
      : [verify.headers['set-cookie'] as string];
    const trustedCookie = cookies.find((c) => c.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`));
    expect(trustedCookie).toBeDefined();
    const cookieToken = trustedCookie!.split(';')[0];

    captured.clear();
    const second = await postLogin(
      { email: DOCTOR_EMAIL, password: SEED_DOCTOR_PASSWORD, rememberMe: false },
      { cookie: cookieToken },
    );
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('authenticated');
    expect(captured.takeLatest(DOCTOR_EMAIL)).toBeUndefined();
  });

  it('cross-tenant: doctor cannot log in on a different clinic subdomain', async () => {
    // Provision a second clinic so the host resolves to a different
    // clinic_id, then attempt to log the doctor in there.
    await prisma.clinic.upsert({
      where: { subdomain: 'authtest' },
      update: {},
      create: {
        subdomain: 'authtest',
        name: 'Auth Test Clinic',
        shortName: 'AuthTest',
        address: 'n/a',
        city: 'n/a',
        phones: [],
        email: 'authtest@example.com',
        hoursConfig: {},
        paymentCodes: {},
        logoUrl: '/assets/test/logo.png',
        signatureUrl: '/assets/test/sig.png',
        status: 'active',
      },
    });

    const res = await postLogin(
      { email: DOCTOR_EMAIL, password: SEED_DOCTOR_PASSWORD, rememberMe: false },
      { host: 'authtest.klinika.health' },
    );
    expect(res.status).toBe(401);
  });

  it('rate limit: 5 IP-bound failures in a minute trip the 429', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 7; i += 1) {
      const r = await postLogin({
        email: DOCTOR_EMAIL,
        password: 'definitely-wrong-password',
        rememberMe: false,
      });
      lastStatus = r.status;
    }
    // After 5 401s the 6th+ should be 429.
    expect(lastStatus).toBe(429);
  });
});
