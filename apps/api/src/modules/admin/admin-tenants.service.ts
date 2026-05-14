import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { EmailService } from '../email/email.service';
import type {
  CreateTenantRequest,
  TenantDetail,
  TenantSummary,
} from './admin.dto';
import type { PlatformAuditContext } from './platform-audit.service';
import { PlatformAuditService } from './platform-audit.service';
import {
  RESERVED_SUBDOMAINS,
  subdomainErrorMessage,
  validateSubdomain,
} from './subdomain-validation';

const TEMP_PASSWORD_BYTES = 12; // → 16-char base64url; meets the 10-char minimum.
const RECENT_AUDIT_LIMIT = 10;
const HEARTBEAT_FRESHNESS_MS = 10 * 60_000; // 10 minutes

const ADMIN_AUDIT_ACTIONS_OF_INTEREST = new Set([
  'auth.login.success',
  'auth.login.failed',
  'auth.password.changed',
  'auth.sessions.revoked',
  'auth.device.revoked',
]);

/**
 * Cross-tenant operations performed by platform admins:
 *
 *   - List all tenants with summary metrics
 *   - Inspect one tenant (users, telemetry, recent audit)
 *   - Create a new tenant (clinic row + initial clinic_admin user +
 *     setup email)
 *   - Suspend / activate a tenant
 *
 * Every state-changing operation writes to `platform_audit_log`.
 *
 * These queries deliberately bypass RLS because platform admins are
 * cross-tenant by design (ADR-005). Prisma in the API process is
 * connected as a BYPASSRLS-capable role in production; in dev the
 * DB user is BYPASSRLS by default. The queries are still scoped by
 * `clinic_id` to the exact tenant the admin is acting on, so a bug
 * here cannot return rows from unrelated clinics — but the safety net
 * (RLS) is intentionally not engaged for these calls.
 */
@Injectable()
export class AdminTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly email: EmailService,
    private readonly audit: PlatformAuditService,
    @InjectPinoLogger(AdminTenantsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async listTenants(): Promise<TenantSummary[]> {
    const clinics = await this.prisma.clinic.findMany({
      orderBy: [{ createdAt: 'desc' }],
      select: {
        id: true,
        name: true,
        shortName: true,
        subdomain: true,
        city: true,
        status: true,
        createdAt: true,
      },
    });
    const clinicIds = clinics.map((c) => c.id);

    if (clinicIds.length === 0) return [];

    const [userCounts, patientCounts, visitCounts, lastActivities] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['clinicId'],
        where: { clinicId: { in: clinicIds }, deletedAt: null },
        _count: true,
      }),
      this.prisma.patient.groupBy({
        by: ['clinicId'],
        where: { clinicId: { in: clinicIds }, deletedAt: null },
        _count: true,
      }),
      this.prisma.visit.groupBy({
        by: ['clinicId'],
        where: { clinicId: { in: clinicIds }, deletedAt: null },
        _count: true,
      }),
      this.prisma.auditLog.groupBy({
        by: ['clinicId'],
        where: { clinicId: { in: clinicIds } },
        _max: { timestamp: true },
      }),
    ]);

    const byId = <T extends { clinicId: string }>(arr: T[]): Map<string, T> =>
      new Map(arr.map((r) => [r.clinicId, r]));
    const users = byId(userCounts);
    const patients = byId(patientCounts);
    const visits = byId(visitCounts);
    const activity = byId(lastActivities);

    return clinics.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      subdomain: c.subdomain,
      city: c.city,
      status: c.status,
      userCount: users.get(c.id)?._count ?? 0,
      patientCount: patients.get(c.id)?._count ?? 0,
      visitCount: visits.get(c.id)?._count ?? 0,
      createdAt: c.createdAt.toISOString(),
      lastActivityAt: activity.get(c.id)?._max?.timestamp?.toISOString() ?? null,
    }));
  }

  async getTenant(id: string): Promise<TenantDetail> {
    const clinic = await this.prisma.clinic.findFirst({
      where: { id, deletedAt: null },
    });
    if (!clinic) {
      throw new NotFoundException('Klinika nuk u gjet.');
    }

    const [users, patientCount, visitCount, lastActivity, heartbeat, recentAudit] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { clinicId: id, deletedAt: null },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            roles: true,
            isActive: true,
            lastLoginAt: true,
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.patient.count({ where: { clinicId: id, deletedAt: null } }),
        this.prisma.visit.count({ where: { clinicId: id, deletedAt: null } }),
        this.prisma.auditLog.aggregate({
          where: { clinicId: id },
          _max: { timestamp: true },
        }),
        this.prisma.telemetryHeartbeat.findFirst({
          where: { tenantId: clinic.subdomain },
          orderBy: { receivedAt: 'desc' },
        }),
        this.prisma.auditLog.findMany({
          where: { clinicId: id },
          orderBy: { timestamp: 'desc' },
          take: RECENT_AUDIT_LIMIT,
        }),
      ]);

    const userById = new Map(users.map((u) => [u.id, u.email] as const));

    // Telemetry freshness: a stale heartbeat (>10min) gets reported as
    // null so the dashboard shows "no data" instead of stale numbers.
    const fresh =
      heartbeat &&
      Date.now() - heartbeat.receivedAt.getTime() < HEARTBEAT_FRESHNESS_MS;

    return {
      id: clinic.id,
      name: clinic.name,
      shortName: clinic.shortName,
      subdomain: clinic.subdomain,
      address: clinic.address,
      city: clinic.city,
      phones: clinic.phones,
      contactEmail: clinic.email,
      status: clinic.status,
      userCount: users.length,
      patientCount,
      visitCount,
      createdAt: clinic.createdAt.toISOString(),
      lastActivityAt: lastActivity._max.timestamp?.toISOString() ?? null,
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        roles: u.roles as Array<'doctor' | 'receptionist' | 'clinic_admin'>,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      })),
      telemetry: {
        lastHeartbeatAt: heartbeat?.receivedAt.toISOString() ?? null,
        appHealthy: fresh && heartbeat ? heartbeat.appHealthy : null,
        dbHealthy: fresh && heartbeat ? heartbeat.dbHealthy : null,
        orthancHealthy: fresh && heartbeat ? heartbeat.orthancHealthy : null,
        cpuPercent: fresh && heartbeat ? heartbeat.cpuPercent.toNumber() : null,
        ramPercent: fresh && heartbeat ? heartbeat.ramPercent.toNumber() : null,
        diskPercent: fresh && heartbeat ? heartbeat.diskPercent.toNumber() : null,
        lastBackupAt: heartbeat?.lastBackupAt?.toISOString() ?? null,
        queueDepth: fresh && heartbeat ? heartbeat.queueDepth : null,
        errorRate5xx: fresh && heartbeat ? heartbeat.errorRate5xx : null,
      },
      recentAudit: recentAudit
        .filter((row) => ADMIN_AUDIT_ACTIONS_OF_INTEREST.has(row.action))
        .map((row) => ({
          id: row.id,
          action: row.action,
          resourceType: row.resourceType,
          timestamp: row.timestamp.toISOString(),
          actorEmail: userById.get(row.userId) ?? null,
        })),
    };
  }

  /**
   * Pre-create subdomain availability check. Always responds with
   * `ok: true|false` plus a reason — never throws — so the form can
   * surface inline feedback as the user types.
   */
  async checkSubdomainAvailability(
    raw: string,
  ): Promise<{ available: boolean; reason?: string; subdomain: string }> {
    const validation = validateSubdomain(raw);
    const normalised = raw.trim().toLowerCase();
    if (!validation.ok) {
      return {
        available: false,
        subdomain: normalised,
        reason: subdomainErrorMessage(validation.reason!),
      };
    }
    const taken = await this.prisma.clinic.findFirst({
      where: { subdomain: normalised },
      select: { id: true },
    });
    if (taken) {
      return { available: false, subdomain: normalised, reason: 'Ky subdomain është i zënë.' };
    }
    return { available: true, subdomain: normalised };
  }

  async createTenant(payload: CreateTenantRequest, ctx: PlatformAuditContext): Promise<TenantDetail> {
    const validation = validateSubdomain(payload.subdomain);
    if (!validation.ok) {
      throw new BadRequestException(subdomainErrorMessage(validation.reason!));
    }
    const subdomain = payload.subdomain;

    // Pre-check (cheap) so the user gets a friendly message before the
    // expensive password hashing + email send. The unique index on
    // `clinics.subdomain` is the real authoritative check below.
    const existingClinic = await this.prisma.clinic.findFirst({ where: { subdomain } });
    if (existingClinic) {
      throw new ConflictException('Ky subdomain është i zënë.');
    }
    const existingEmail = await this.prisma.user.findUnique({ where: { email: payload.adminEmail } });
    if (existingEmail) {
      throw new ConflictException('Ky email është tashmë i regjistruar.');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);

    // Single transaction so a failure in user creation doesn't leave
    // an orphan clinic row.
    const created = await this.prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.create({
        data: {
          subdomain,
          name: payload.name,
          shortName: payload.shortName,
          address: payload.address,
          city: payload.city,
          phones: payload.phones,
          email: payload.contactEmail,
          hoursConfig: defaultHoursConfig(),
          paymentCodes: defaultPaymentCodes(),
          logoUrl: `/assets/clinics/${subdomain}/logo.png`,
          signatureUrl: `/assets/clinics/${subdomain}/signature-blank.png`,
          status: 'active',
        },
      });
      const user = await tx.user.create({
        data: {
          clinicId: clinic.id,
          email: payload.adminEmail,
          passwordHash,
          roles: ['clinic_admin'],
          firstName: payload.adminFirstName,
          lastName: payload.adminLastName,
          isActive: true,
        },
      });
      return { clinic, user };
    });

    const loginUrl = `https://${subdomain}.klinika.health/login`;
    // Send the setup email after the DB commit. Failure here logs but
    // does not abort — the admin can resend manually if needed.
    try {
      await this.email.sendTenantSetup(payload.adminEmail, {
        firstName: payload.adminFirstName,
        clinicName: payload.name,
        subdomain,
        loginUrl,
        temporaryPassword,
      });
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), clinicId: created.clinic.id },
        'Tenant setup email failed to send',
      );
    }

    await this.audit.record({
      ctx,
      action: 'tenant.created',
      resourceType: 'clinic',
      resourceId: created.clinic.id,
      targetClinicId: created.clinic.id,
      metadata: {
        subdomain,
        adminUserId: created.user.id,
        adminEmail: payload.adminEmail,
      },
    });
    this.logger.info(
      { clinicId: created.clinic.id, subdomain, by: ctx.platformAdminId },
      'Tenant created',
    );

    return this.getTenant(created.clinic.id);
  }

  async setStatus(
    id: string,
    nextStatus: 'active' | 'suspended',
    ctx: PlatformAuditContext,
    note?: string,
  ): Promise<TenantDetail> {
    const clinic = await this.prisma.clinic.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, status: true, subdomain: true },
    });
    if (!clinic) {
      throw new NotFoundException('Klinika nuk u gjet.');
    }
    if (clinic.status === nextStatus) {
      // Idempotent — return current state without writing an audit row
      // for a no-op transition.
      return this.getTenant(id);
    }

    await this.prisma.clinic.update({
      where: { id },
      data: { status: nextStatus },
    });

    if (nextStatus === 'suspended') {
      // Revoke every active tenant session so the suspension takes
      // effect on the next request even if a session is mid-life.
      // Trusted-device cookies remain so re-activation is seamless.
      await this.prisma.authSession.updateMany({
        where: { clinicId: id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'tenant_suspended' },
      });
    }

    await this.audit.record({
      ctx,
      action: nextStatus === 'suspended' ? 'tenant.suspended' : 'tenant.activated',
      resourceType: 'clinic',
      resourceId: id,
      targetClinicId: id,
      metadata: { previousStatus: clinic.status, note: note ?? null },
    });
    this.logger.warn(
      { clinicId: id, nextStatus, by: ctx.platformAdminId },
      'Tenant status changed',
    );
    return this.getTenant(id);
  }
}

function defaultHoursConfig(): Prisma.InputJsonValue {
  // Mirrors the shape the clinic-settings UI consumes (see
  // `apps/api/src/modules/clinic-settings/clinic-settings.dto.ts`).
  // New tenants land on these defaults; admin refines from the
  // Cilësimet → Orari panel later.
  const weekday = { open: true as const, start: '09:00', end: '17:00' };
  return {
    timezone: 'Europe/Belgrade',
    days: {
      mon: weekday,
      tue: weekday,
      wed: weekday,
      thu: weekday,
      fri: weekday,
      sat: { open: false },
      sun: { open: false },
    },
    durations: [10, 15, 20, 30, 45],
    defaultDuration: 15,
  };
}

function defaultPaymentCodes(): Prisma.InputJsonValue {
  // Matches the codes the migration tool understands for legacy data
  // and the labels/amounts the clinic-settings DTO validates. Amounts
  // are in cents; €0–€20 ranges align with DonetaMED's pricing.
  return {
    E: { label: 'Falas', amountCents: 0 },
    A: { label: 'Vizitë standarde', amountCents: 1500 },
    B: { label: 'Vizitë e shkurtër', amountCents: 1000 },
    C: { label: 'Kontroll', amountCents: 500 },
    D: { label: 'Vizitë e gjatë', amountCents: 2000 },
  };
}

function generateTemporaryPassword(): string {
  // 12 random bytes → 16 base64url chars. Mixed case + digits + `-`/`_`
  // satisfies the password strength heuristic (medium+ at length 16),
  // and is human-typable from the email body if the user can't paste.
  return randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
}

// Re-export so callers don't need to import from the validation module
// separately when they want a sanity-check list (e.g. tests).
export { RESERVED_SUBDOMAINS };
