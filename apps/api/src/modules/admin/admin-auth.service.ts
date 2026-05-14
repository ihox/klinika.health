import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { GENERIC_INVALID_CREDENTIALS_MESSAGE } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { maskEmail } from '../auth/device';
import { PasswordService } from '../auth/password.service';
import { EmailService } from '../email/email.service';
import { AdminMfaService } from './admin-mfa.service';
import { AdminSessionService } from './admin-session.service';
import { PlatformAuditService } from './platform-audit.service';

const SENTINEL_ARGON_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$YWRtaW4tc2VudGluZWwxMjM0NQ$8KGqK4tQ7E1iZqGQpRMqW8C4iX/c8c4nVQHcEa6Vk/U';

const MS_PER_MINUTE = 60_000;

export type BeginAdminLoginResult =
  | { status: 'mfa_required'; pendingSessionId: string; maskedEmail: string }
  | { status: 'authenticated'; sessionToken: string; sessionExpiresAt: Date; platformAdminId: string };

/**
 * Authentication service for platform admins. Mirrors the shape of the
 * tenant {@link AuthService} but operates against `platform_admins`,
 * `auth_admin_*` tables, and the `klinika_admin_session` cookie.
 *
 * Every successful login flows through MFA — there's no trusted-device
 * shortcut for platform admins (admin compromise is platform-wide; we
 * accept the friction).
 */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: AdminSessionService,
    private readonly mfa: AdminMfaService,
    private readonly email: EmailService,
    private readonly audit: PlatformAuditService,
    @InjectPinoLogger(AdminAuthService.name)
    private readonly logger: PinoLogger,
  ) {}

  async beginLogin(
    email: string,
    password: string,
    ctx: RequestContext,
  ): Promise<BeginAdminLoginResult> {
    if (!ctx.isPlatform) {
      // Belt-and-braces — the controller's @PlatformScope() already
      // surfaces this as a generic 401 via ClinicScopeGuard. We pay
      // the Argon2 cost anyway so timing doesn't reveal scope.
      await this.passwords.verify(SENTINEL_ARGON_HASH, password);
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }
    const emailLower = email.toLowerCase();
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: emailLower } });

    const verified = admin
      ? await this.passwords.verify(admin.passwordHash, password)
      : await this.passwords.verify(SENTINEL_ARGON_HASH, password);

    if (!admin || !verified || !admin.isActive) {
      this.logger.warn(
        { emailLower, ipAddress: ctx.ipAddress },
        'Admin login attempt failed',
      );
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    const mfa = await this.mfa.issue(admin.id, ctx);
    await this.email.sendMfaCode(admin.email, {
      firstName: admin.firstName,
      code: mfa.rawCode,
      ttlMinutes: Math.round((mfa.expiresAt.getTime() - Date.now()) / MS_PER_MINUTE),
    });
    await this.audit.record({
      ctx: {
        platformAdminId: admin.id,
        sessionId: null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      action: 'admin.mfa.sent',
      resourceType: 'admin_mfa_code',
      resourceId: mfa.pendingSessionId,
    });
    return {
      status: 'mfa_required',
      pendingSessionId: mfa.pendingSessionId,
      maskedEmail: maskEmail(admin.email),
    };
  }

  async verifyMfa(
    pendingSessionId: string,
    code: string,
    ctx: RequestContext,
  ): Promise<{
    sessionToken: string;
    sessionExpiresAt: Date;
    platformAdminId: string;
  }> {
    if (!ctx.isPlatform) {
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }
    const outcome = await this.mfa.verify(pendingSessionId, code);
    if (!outcome.ok) {
      const msg =
        outcome.reason === 'expired'
          ? 'Kodi ka skaduar. Kërkoni një kod të ri.'
          : outcome.reason === 'too_many_attempts'
            ? 'Tepër përpjekje. Filloni prej fillimit.'
            : 'Kod i pasaktë. Provoni përsëri.';
      throw new UnauthorizedException({ reason: outcome.reason, message: msg });
    }

    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: outcome.platformAdminId } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    const session = await this.sessions.issue(admin.id, ctx);
    await this.prisma.platformAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      ctx: {
        platformAdminId: admin.id,
        sessionId: session.sessionId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      action: 'admin.login.success',
      resourceType: 'admin_session',
      resourceId: session.sessionId,
    });
    return {
      sessionToken: session.rawToken,
      sessionExpiresAt: session.expiresAt,
      platformAdminId: admin.id,
    };
  }

  async resendMfa(pendingSessionId: string, ctx: RequestContext): Promise<{ maskedEmail: string }> {
    const pending = await this.mfa.findPending(pendingSessionId);
    if (!pending) {
      throw new BadRequestException('Sesioni i verifikimit nuk u gjet.');
    }
    if (pending.consumedAt) {
      throw new BadRequestException('Kodi është verifikuar tashmë.');
    }
    const admin = await this.prisma.platformAdmin.findUnique({ where: { id: pending.platformAdminId } });
    if (!admin || !admin.isActive) {
      throw new BadRequestException('Llogaria nuk është aktive.');
    }

    await this.mfa.expirePending(pendingSessionId);
    const fresh = await this.mfa.issue(admin.id, ctx);
    await this.email.sendMfaCode(admin.email, {
      firstName: admin.firstName,
      code: fresh.rawCode,
      ttlMinutes: Math.round((fresh.expiresAt.getTime() - Date.now()) / MS_PER_MINUTE),
    });
    await this.audit.record({
      ctx: {
        platformAdminId: admin.id,
        sessionId: null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      action: 'admin.mfa.sent',
      resourceType: 'admin_mfa_code',
      resourceId: fresh.pendingSessionId,
    });
    return { maskedEmail: maskEmail(admin.email) };
  }

  async getProfile(platformAdminId: string): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    lastLoginAt: Date | null;
    createdAt: Date;
  }> {
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: platformAdminId },
    });
    return {
      id: admin.id,
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
    };
  }
}
