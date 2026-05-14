import { randomBytes } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { EmailService } from '../email/email.service';
import type { CreatePlatformAdminRequest, PlatformAdminSummary } from './admin.dto';
import type { PlatformAuditContext } from './platform-audit.service';
import { PlatformAuditService } from './platform-audit.service';

const TEMP_PASSWORD_BYTES = 12;
// Platform admins log in on the apex domain — never on a dedicated
// admin.* subdomain. See ADR-005 boundary enforcement update.
const ADMIN_LOGIN_URL = 'https://klinika.health/login';

/**
 * Platform-admin account management. Same shape as
 * {@link AdminTenantsService}: list + create. Deletion lives in SQL
 * for now (per the schema comment on `PlatformAdmin`).
 */
@Injectable()
export class AdminPlatformAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly email: EmailService,
    private readonly audit: PlatformAuditService,
    @InjectPinoLogger(AdminPlatformAdminsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async list(): Promise<PlatformAdminSummary[]> {
    const admins = await this.prisma.platformAdmin.findMany({
      orderBy: [{ createdAt: 'asc' }],
    });
    return admins.map((a) => ({
      id: a.id,
      email: a.email,
      firstName: a.firstName,
      lastName: a.lastName,
      isActive: a.isActive,
      lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async create(
    payload: CreatePlatformAdminRequest,
    ctx: PlatformAuditContext,
  ): Promise<PlatformAdminSummary> {
    const existing = await this.prisma.platformAdmin.findUnique({ where: { email: payload.email } });
    if (existing) {
      throw new ConflictException('Ky email ka tashmë llogari admin platforme.');
    }
    // Guard against accidentally giving a clinic user the same email
    // — it would split their identity across tables and break the
    // "one email per identity" invariant we lean on for password
    // resets and audit lookup.
    const clinicUser = await this.prisma.user.findUnique({ where: { email: payload.email } });
    if (clinicUser) {
      throw new BadRequestException(
        'Ky email përdoret nga një përdorues klinike. Përdorni një tjetër për administratorin.',
      );
    }

    const temporaryPassword = randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
    const passwordHash = await this.passwords.hash(temporaryPassword);

    const created = await this.prisma.platformAdmin.create({
      data: {
        email: payload.email,
        passwordHash,
        firstName: payload.firstName,
        lastName: payload.lastName,
        isActive: true,
      },
    });

    try {
      await this.email.sendTenantSetup(payload.email, {
        firstName: payload.firstName,
        clinicName: 'Klinika · Platform Admin',
        subdomain: 'admin',
        loginUrl: ADMIN_LOGIN_URL,
        temporaryPassword,
      });
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), platformAdminId: created.id },
        'Platform admin setup email failed to send',
      );
    }

    await this.audit.record({
      ctx,
      action: 'platform_admin.created',
      resourceType: 'platform_admin',
      resourceId: created.id,
      metadata: { email: payload.email },
    });

    return {
      id: created.id,
      email: created.email,
      firstName: created.firstName,
      lastName: created.lastName,
      isActive: created.isActive,
      lastLoginAt: created.lastLoginAt?.toISOString() ?? null,
      createdAt: created.createdAt.toISOString(),
    };
  }
}
