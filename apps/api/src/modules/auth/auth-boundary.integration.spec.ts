// Integration tests for the platform-vs-clinic boundary (ADR-005 fix).
//
// Confirms that, no matter which combination of host / endpoint /
// session cookie a request presents, the only responses an attacker
// can observe for credential-style failures are:
//   - 200 (we don't test the success path here — that's auth.integration.spec)
//   - 401 with `Email-i ose fjalëkalimi është i pasaktë.` for wrong
//     email / wrong password / wrong scope / wrong-clinic session
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
import { ADMIN_SESSION_COOKIE_NAME } from '../admin/admin-session.service';
import { SESSION_COOKIE_NAME } from './session.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const SEED_PLATFORM_ADMIN_PASSWORD = process.env['SEED_PLATFORM_ADMIN_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_DOCTOR_PASSWORD && SEED_PLATFORM_ADMIN_PASSWORD);

const APEX_HOST = 'klinika.health';
const TENANT_HOST = 'donetamed.klinika.health';
const OTHER_TENANT_HOST = 'authtest-boundary.klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';
const FOUNDER_EMAIL = 'founder@klinika.health';

// The exact message the API returns for every credential-style
// failure. Tests compare server response bodies against this — any
// drift breaks the boundary's "no scope leak" guarantee.
const GENERIC_INVALID = 'Email-i ose fjalëkalimi është i pasaktë.';

describe.skipIf(!ENABLED)('Auth boundary integration', () => {
  let app: NestExpressApplication;
  let module: TestingModule;
  let prisma: PrismaService;
  let captured: CapturingEmailSender;

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

    captured = new CapturingEmailSender();
    module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EMAIL_SENDER)
      .useValue(captured)
      .compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', true);
    await app.init();
    prisma = app.get(PrismaService);
    app.get(EmailService).setSender(captured);

    // Provision a second clinic so cross-tenant cases have a target.
    await prisma.clinic.upsert({
      where: { subdomain: 'authtest-boundary' },
      update: {},
      create: {
        subdomain: 'authtest-boundary',
        name: 'Auth Boundary Clinic',
        shortName: 'AuthBoundary',
        address: 'n/a',
        city: 'n/a',
        phones: [],
        email: 'authtest-boundary@example.com',
        hoursConfig: {},
        paymentCodes: {},
        logoUrl: '/assets/test/logo.png',
        signatureUrl: '/assets/test/sig.png',
        status: 'active',
      },
    });
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
    await prisma.authAdminMfaCode.deleteMany({});
    await prisma.authAdminSession.deleteMany({});
    // Make sure the seed clinic is back to active.
    await prisma.clinic.updateMany({
      where: { subdomain: 'donetamed' },
      data: { status: 'active' },
    });
  });

  // ---- Helpers -----------------------------------------------------

  function post(path: string, host: string, body: Record<string, unknown>, cookie?: string) {
    const r = request(app.getHttpServer())
      .post(path)
      .set('host', host)
      .set('Content-Type', 'application/json');
    if (cookie) r.set('Cookie', cookie);
    return r.send(body);
  }

  function get(path: string, host: string, cookie?: string) {
    const r = request(app.getHttpServer()).get(path).set('host', host);
    if (cookie) r.set('Cookie', cookie);
    return r;
  }

  async function loginPlatformAdmin(): Promise<string> {
    const start = await post('/api/admin/auth/login', APEX_HOST, {
      email: FOUNDER_EMAIL,
      password: SEED_PLATFORM_ADMIN_PASSWORD,
    });
    expect(start.status).toBe(200);
    const email = captured.takeLatest(FOUNDER_EMAIL);
    const match = email!.text.match(/(\d{3}) (\d{3})/);
    const code = match ? `${match[1]}${match[2]}` : '';
    const verify = await post('/api/admin/auth/mfa/verify', APEX_HOST, {
      pendingSessionId: start.body.pendingSessionId,
      code,
    });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie as string];
    const session = cookies.find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`));
    captured.clear();
    return session!.split(';')[0];
  }

  async function loginClinicDoctor(): Promise<string> {
    const start = await post('/api/auth/login', TENANT_HOST, {
      email: DOCTOR_EMAIL,
      password: SEED_DOCTOR_PASSWORD,
      rememberMe: false,
    });
    expect(start.status).toBe(200);
    const email = captured.takeLatest(DOCTOR_EMAIL);
    const match = email!.text.match(/(\d{3}) (\d{3})/);
    const code = match ? `${match[1]}${match[2]}` : '';
    const verify = await post('/api/auth/mfa/verify', TENANT_HOST, {
      pendingSessionId: start.body.pendingSessionId,
      code,
      trustDevice: false,
    });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie as string];
    const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
    captured.clear();
    return session!.split(';')[0];
  }

  // ---- Tests -------------------------------------------------------

  it('reserved subdomain hosts are rejected with 400 at the edge', async () => {
    const r = await get('/api/auth/login', 'admin.klinika.health');
    expect(r.status).toBe(400);
    expect(r.body.reason).toBe('reserved_subdomain');
  });

  it('unknown clinic subdomain returns 404 clinic_not_found', async () => {
    const r = await get('/api/auth/login', 'does-not-exist.klinika.health');
    expect(r.status).toBe(404);
    expect(r.body.reason).toBe('clinic_not_found');
  });

  it('clinic user CANNOT log in via apex — returns the generic 401', async () => {
    const r = await post('/api/auth/login', APEX_HOST, {
      email: DOCTOR_EMAIL,
      password: SEED_DOCTOR_PASSWORD,
      rememberMe: false,
    });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC_INVALID);
  });

  it('platform admin CANNOT log in via clinic subdomain — returns the generic 401', async () => {
    const r = await post('/api/admin/auth/login', TENANT_HOST, {
      email: FOUNDER_EMAIL,
      password: SEED_PLATFORM_ADMIN_PASSWORD,
    });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC_INVALID);
  });

  it('cross-clinic: doctor cannot log in on another clinic subdomain', async () => {
    const r = await post('/api/auth/login', OTHER_TENANT_HOST, {
      email: DOCTOR_EMAIL,
      password: SEED_DOCTOR_PASSWORD,
      rememberMe: false,
    });
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC_INVALID);
  });

  it('error message is CHARACTER-IDENTICAL for wrong email, wrong password, and wrong scope', async () => {
    const wrongEmail = await post('/api/auth/login', TENANT_HOST, {
      email: 'nobody@example.com',
      password: SEED_DOCTOR_PASSWORD,
      rememberMe: false,
    });
    const wrongPassword = await post('/api/auth/login', TENANT_HOST, {
      email: DOCTOR_EMAIL,
      password: 'absolutely-not-the-password',
      rememberMe: false,
    });
    const wrongScope = await post('/api/auth/login', APEX_HOST, {
      email: DOCTOR_EMAIL,
      password: SEED_DOCTOR_PASSWORD,
      rememberMe: false,
    });
    const adminOnSubdomain = await post('/api/admin/auth/login', TENANT_HOST, {
      email: FOUNDER_EMAIL,
      password: SEED_PLATFORM_ADMIN_PASSWORD,
    });

    expect(wrongEmail.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(wrongScope.status).toBe(401);
    expect(adminOnSubdomain.status).toBe(401);

    // Character-equal — the boundary's core guarantee.
    expect(wrongEmail.body.message).toBe(GENERIC_INVALID);
    expect(wrongPassword.body.message).toBe(GENERIC_INVALID);
    expect(wrongScope.body.message).toBe(GENERIC_INVALID);
    expect(adminOnSubdomain.body.message).toBe(GENERIC_INVALID);
  });

  it('/api/admin/* on a tenant subdomain returns 401 (not 403)', async () => {
    const r = await get('/api/admin/tenants', TENANT_HOST);
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC_INVALID);
  });

  it('clinic session cookie presented on apex is rejected with the generic 401', async () => {
    const clinicCookie = await loginClinicDoctor();
    const r = await get('/api/auth/me', APEX_HOST, clinicCookie);
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC_INVALID);
  });

  it('admin session cookie presented on a tenant subdomain is rejected with the generic 401', async () => {
    const adminCookie = await loginPlatformAdmin();
    const r = await get('/api/admin/auth/me', TENANT_HOST, adminCookie);
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC_INVALID);
  });

  it('clinic session cookie presented on a different clinic subdomain is rejected', async () => {
    const clinicCookie = await loginClinicDoctor();
    const r = await get('/api/auth/me', OTHER_TENANT_HOST, clinicCookie);
    expect(r.status).toBe(401);
    expect(r.body.message).toBe(GENERIC_INVALID);
  });

  it('clinic-identity is public on tenant scope, generic 401 on apex', async () => {
    const tenant = await get('/api/auth/clinic-identity', TENANT_HOST);
    expect(tenant.status).toBe(200);
    expect(tenant.body.subdomain).toBe('donetamed');
    expect(typeof tenant.body.name).toBe('string');
    expect(typeof tenant.body.shortName).toBe('string');

    const apex = await get('/api/auth/clinic-identity', APEX_HOST);
    expect(apex.status).toBe(401);
    expect(apex.body.message).toBe(GENERIC_INVALID);
  });
});
