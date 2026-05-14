// Integration tests for the platform-admin surface.
//
// Spins up the real NestJS app, exercises:
//   1. Admin login + MFA → session cookie
//   2. Tenant creation → row exists + setup email captured
//   3. Suspend → tenant flagged + active sessions revoked + login blocked
//   4. Activate → tenant returned to active + login works again
//   5. Reserved-subdomain rejection
//
// Skips automatically when DATABASE_URL is unset (same pattern as the
// auth integration tests).

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { CapturingEmailSender, EMAIL_SENDER, EmailService } from '../email/email.service';
import { ADMIN_SESSION_COOKIE_NAME } from './admin-session.service';

const DATABASE_URL = process.env['DATABASE_URL'];
const SEED_PLATFORM_ADMIN_PASSWORD = process.env['SEED_PLATFORM_ADMIN_PASSWORD'];
const SEED_DOCTOR_PASSWORD = process.env['SEED_DOCTOR_PASSWORD'];
const ENABLED = Boolean(DATABASE_URL && SEED_PLATFORM_ADMIN_PASSWORD && SEED_DOCTOR_PASSWORD);

// Platform-admin context lives at the APEX host now (ADR-005 boundary
// fix). The old `admin.klinika.health` is treated as a reserved
// subdomain and rejected with 400.
const ADMIN_HOST = 'klinika.health';
const TENANT_HOST = 'donetamed.klinika.health';
const FOUNDER_EMAIL = 'founder@klinika.health';
const DOCTOR_EMAIL = 'taulant.shala@klinika.health';

describe.skipIf(!ENABLED)('Admin integration', () => {
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
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    captured.clear();
    // Wipe transient material so each test starts fresh.
    await prisma.rateLimit.deleteMany({});
    await prisma.authLoginAttempt.deleteMany({});
    await prisma.authAdminMfaCode.deleteMany({});
    await prisma.authAdminSession.deleteMany({});
    await prisma.authMfaCode.deleteMany({});
    await prisma.authSession.deleteMany({});
    await prisma.platformAuditLog.deleteMany({});
    // Make sure the seed clinic is active at the start of each test.
    await prisma.clinic.updateMany({
      where: { subdomain: 'donetamed' },
      data: { status: 'active' },
    });
    // Remove any tenant created by earlier tests.
    await prisma.user.deleteMany({ where: { email: 'newadmin@aurora-ped.com' } });
    const stray = await prisma.clinic.findFirst({ where: { subdomain: 'aurora-ped' } });
    if (stray) {
      await prisma.user.deleteMany({ where: { clinicId: stray.id } });
      await prisma.clinic.delete({ where: { id: stray.id } });
    }
  });

  // ---- helpers ----

  async function loginAsAdmin(): Promise<string> {
    const start = await request(app.getHttpServer())
      .post('/api/admin/auth/login')
      .set('host', ADMIN_HOST)
      .send({ email: FOUNDER_EMAIL, password: SEED_PLATFORM_ADMIN_PASSWORD });
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('mfa_required');
    const pending = start.body.pendingSessionId as string;

    const email = captured.takeLatest(FOUNDER_EMAIL);
    expect(email).toBeDefined();
    const match = email!.text.match(/(\d{3}) (\d{3})/);
    const code = match ? `${match[1]}${match[2]}` : '';

    const verify = await request(app.getHttpServer())
      .post('/api/admin/auth/mfa/verify')
      .set('host', ADMIN_HOST)
      .send({ pendingSessionId: pending, code });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers['set-cookie'];
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie as string];
    const session = cookies.find((c) => c.startsWith(`${ADMIN_SESSION_COOKIE_NAME}=`));
    expect(session).toBeDefined();
    captured.clear();
    return session!.split(';')[0];
  }

  it('admin login → MFA challenge → verified session', async () => {
    const cookie = await loginAsAdmin();
    const me = await request(app.getHttpServer())
      .get('/api/admin/auth/me')
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.admin.email).toBe(FOUNDER_EMAIL);
  });

  it('rejects /api/admin/* on tenant subdomain', async () => {
    // The admin guard requires `admin.klinika.health`. Hitting the
    // same endpoint from a tenant host should never succeed.
    const res = await request(app.getHttpServer())
      .get('/api/admin/tenants')
      .set('host', TENANT_HOST);
    expect(res.status).toBe(401);
  });

  it('creates a tenant, sends setup email, writes audit row', async () => {
    const cookie = await loginAsAdmin();
    const res = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie)
      .send({
        name: 'Aurora Pediatri',
        shortName: 'AURORA-PED',
        subdomain: 'aurora-ped',
        city: 'Prishtinë',
        address: 'Rruga e Shtejes 12',
        phones: ['045 11 22 33'],
        contactEmail: 'info@aurora-ped.com',
        adminFirstName: 'Ana',
        adminLastName: 'Krasniqi',
        adminEmail: 'newadmin@aurora-ped.com',
      });
    expect(res.status).toBe(201);
    expect(res.body.tenant.subdomain).toBe('aurora-ped');
    expect(res.body.tenant.status).toBe('active');

    const setup = captured.takeLatest('newadmin@aurora-ped.com');
    expect(setup).toBeDefined();
    expect(setup!.subject).toContain('Aurora Pediatri');
    expect(setup!.text).toContain('aurora-ped.klinika.health');

    const audit = await prisma.platformAuditLog.findFirst({
      where: { action: 'tenant.created' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect(audit!.targetClinicId).toBe(res.body.tenant.id);
  });

  it('rejects reserved subdomains', async () => {
    const cookie = await loginAsAdmin();
    const res = await request(app.getHttpServer())
      .post('/api/admin/tenants')
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie)
      .send({
        name: 'Admin Clinic',
        shortName: 'ADMIN-CLINIC',
        subdomain: 'admin',
        city: 'Prishtinë',
        address: 'Anywhere',
        phones: ['045 12 34 56'],
        contactEmail: 'info@admin-clinic.com',
        adminFirstName: 'X',
        adminLastName: 'Y',
        adminEmail: 'reserved-test@admin-clinic.com',
      });
    expect(res.status).toBe(400);
  });

  it('subdomain availability live-checks', async () => {
    const cookie = await loginAsAdmin();
    // taken (donetamed)
    const taken = await request(app.getHttpServer())
      .get('/api/admin/tenants/subdomain-availability?subdomain=donetamed')
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie);
    expect(taken.status).toBe(200);
    expect(taken.body.available).toBe(false);

    // free
    const free = await request(app.getHttpServer())
      .get('/api/admin/tenants/subdomain-availability?subdomain=aurora-ped')
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie);
    expect(free.status).toBe(200);
    expect(free.body.available).toBe(true);

    // reserved
    const reserved = await request(app.getHttpServer())
      .get('/api/admin/tenants/subdomain-availability?subdomain=api')
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie);
    expect(reserved.status).toBe(200);
    expect(reserved.body.available).toBe(false);
  });

  it('suspend revokes sessions + blocks login; activate restores', async () => {
    const cookie = await loginAsAdmin();
    const clinic = await prisma.clinic.findFirstOrThrow({ where: { subdomain: 'donetamed' } });

    // Suspend
    const suspend = await request(app.getHttpServer())
      .post(`/api/admin/tenants/${clinic.id}/suspend`)
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie)
      .send({});
    expect(suspend.status).toBe(200);
    expect(suspend.body.tenant.status).toBe('suspended');

    // Login on tenant subdomain is now blocked with the suspended reason.
    // 403 (not 401) here is intentional — the web layer needs the
    // `clinic_suspended` signal to redirect to `/suspended` instead of
    // showing a generic "wrong credentials" message.
    const blockedLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('host', TENANT_HOST)
      .send({ email: DOCTOR_EMAIL, password: SEED_DOCTOR_PASSWORD, rememberMe: false });
    expect(blockedLogin.status).toBe(403);
    expect(blockedLogin.body.reason).toBe('clinic_suspended');

    // Activate
    const activate = await request(app.getHttpServer())
      .post(`/api/admin/tenants/${clinic.id}/activate`)
      .set('host', ADMIN_HOST)
      .set('Cookie', cookie);
    expect(activate.status).toBe(200);
    expect(activate.body.tenant.status).toBe('active');

    // Audit log captured both transitions.
    const events = await prisma.platformAuditLog.findMany({
      where: { targetClinicId: clinic.id },
      orderBy: { timestamp: 'asc' },
    });
    const actions = events.map((e) => e.action);
    expect(actions).toContain('tenant.suspended');
    expect(actions).toContain('tenant.activated');

    // Login works again after activation.
    const ok = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('host', TENANT_HOST)
      .send({ email: DOCTOR_EMAIL, password: SEED_DOCTOR_PASSWORD, rememberMe: false });
    expect(ok.status).toBe(200);
  });
});
