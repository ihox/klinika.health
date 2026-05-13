import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { AuditLogService } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { maskIp } from '../email/templates/new-device';
import type { LoginRequest, LoginResponse } from './auth.dto';
import { maskEmail } from './device';
import { MfaService } from './mfa.service';
import { PasswordService, MIN_PASSWORD_LENGTH, ACCEPTABLE_STRENGTHS } from './password.service';
import { SessionService } from './session.service';
import { generateOpaqueToken, hashToken } from './tokens';
import { TrustedDeviceService } from './trusted-device.service';

const PASSWORD_RESET_TTL_MINUTES = 60;
const MS_PER_MINUTE = 60_000;

export interface AuthenticatedLogin {
  status: 'authenticated';
  userId: string;
  clinicId: string;
  role: string;
  sessionToken: string;
  sessionExpiresAt: Date;
}

export interface MfaPendingLogin {
  status: 'mfa_required';
  pendingSessionId: string;
  maskedEmail: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly trustedDevices: TrustedDeviceService,
    private readonly email: EmailService,
    private readonly audit: AuditLogService,
    @InjectPinoLogger(AuthService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Validate email + password. Decide whether to:
   *   1. Issue an MFA challenge (new device), OR
   *   2. Issue a session immediately (trusted device).
   *
   * Always records an `auth_login_attempts` row and an `audit_log`
   * row regardless of outcome. The email is normalised to lowercase
   * before lookup. Failed lookups still pay the Argon2 cost (we
   * verify against a sentinel hash) so timing doesn't reveal account
   * existence.
   */
  async beginLogin(
    payload: LoginRequest,
    trustedDeviceCookie: string | null,
    ctx: RequestContext,
  ): Promise<AuthenticatedLogin | MfaPendingLogin> {
    if (!ctx.clinicId) {
      throw new ForbiddenException('Hyrja kërkon nëndomenin e klinikës.');
    }

    const emailLower = payload.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: emailLower } });

    // Constant-time verify: if the user doesn't exist, verify against
    // a sentinel hash so the failure path takes the same wallclock as
    // a real password mismatch. Argon2 takes ~30ms here.
    const verified = user
      ? await this.passwords.verify(user.passwordHash, payload.password)
      : await this.passwords.verify(SENTINEL_ARGON_HASH, payload.password);

    if (!user || !verified || user.clinicId !== ctx.clinicId || !user.isActive || user.deletedAt) {
      await this.recordAttempt(emailLower, ctx, false, 'invalid_credentials');
      await this.audit.record({
        ctx: { ...ctx, userId: user?.id ?? 'anonymous' },
        action: 'auth.login.failed',
        resourceType: 'session',
        resourceId: user?.id ?? emailLower,
        changes: null,
      });
      // Generic message — never reveal account existence per OWASP.
      throw new UnauthorizedException('Email-i ose fjalëkalimi është i pasaktë.');
    }

    // Trusted-device check: skip MFA if the cookie matches a live row
    // for THIS user. A cookie that maps to a different user is
    // ignored (and silently overwritten on success).
    let trustedDeviceId: string | null = null;
    if (trustedDeviceCookie) {
      const td = await this.trustedDevices.findValid(trustedDeviceCookie);
      if (td && td.userId === user.id && td.clinicId === user.clinicId) {
        trustedDeviceId = td.id;
      }
    }

    if (trustedDeviceId) {
      const session = await this.sessions.issue(user.id, user.clinicId, payload.rememberMe, ctx);
      await this.trustedDevices.touch(trustedDeviceId, ctx);
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      await this.recordAttempt(emailLower, ctx, true, 'trusted_device');
      await this.audit.record({
        ctx: { ...ctx, userId: user.id, sessionId: session.sessionId },
        action: 'auth.login.success',
        resourceType: 'session',
        resourceId: session.sessionId,
        changes: null,
      });
      return {
        status: 'authenticated',
        userId: user.id,
        clinicId: user.clinicId,
        role: user.role,
        sessionToken: session.rawToken,
        sessionExpiresAt: session.expiresAt,
      };
    }

    // New device: issue MFA challenge.
    const mfa = await this.mfa.issue(
      user.id,
      user.clinicId,
      { rememberDevice: true, extendedTtl: payload.rememberMe },
      ctx,
    );
    await this.email.sendMfaCode(user.email, {
      firstName: user.firstName,
      code: mfa.rawCode,
      ttlMinutes: Math.round((mfa.expiresAt.getTime() - Date.now()) / MS_PER_MINUTE),
    });
    await this.recordAttempt(emailLower, ctx, true, 'mfa_pending');
    await this.audit.record({
      ctx: { ...ctx, userId: user.id },
      action: 'auth.mfa.sent',
      resourceType: 'mfa_code',
      resourceId: mfa.pendingSessionId,
      changes: null,
    });

    return {
      status: 'mfa_required',
      pendingSessionId: mfa.pendingSessionId,
      maskedEmail: maskEmail(user.email),
    };
  }

  /**
   * Verify the 6-digit MFA code. On success, issue the session and
   * (if the user kept "mos pyet përsëri" checked) a trusted-device
   * cookie. Send a new-device alert email out-of-band.
   */
  async verifyMfa(
    pendingSessionId: string,
    code: string,
    trustDevice: boolean,
    ctx: RequestContext,
  ): Promise<{
    sessionToken: string;
    sessionExpiresAt: Date;
    userId: string;
    clinicId: string;
    role: string;
    trustedDeviceToken: string | null;
    trustedDeviceExpiresAt: Date | null;
  }> {
    if (!ctx.clinicId) {
      throw new ForbiddenException('Hyrja kërkon nëndomenin e klinikës.');
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
    if (outcome.clinicId !== ctx.clinicId) {
      throw new ForbiddenException('Sesioni i pavlefshëm për këtë klinikë.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: outcome.userId } });
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException('Përdoruesi nuk është aktiv.');
    }

    const session = await this.sessions.issue(user.id, user.clinicId, outcome.extendedTtl, ctx);

    let trustedDeviceToken: string | null = null;
    let trustedDeviceExpiresAt: Date | null = null;
    if (trustDevice) {
      const td = await this.trustedDevices.issue(user.id, user.clinicId, ctx);
      trustedDeviceToken = td.rawToken;
      trustedDeviceExpiresAt = td.expiresAt;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      ctx: { ...ctx, userId: user.id, sessionId: session.sessionId },
      action: 'auth.mfa.verified',
      resourceType: 'mfa_code',
      resourceId: pendingSessionId,
      changes: null,
    });
    await this.audit.record({
      ctx: { ...ctx, userId: user.id, sessionId: session.sessionId },
      action: 'auth.login.success',
      resourceType: 'session',
      resourceId: session.sessionId,
      changes: null,
    });
    if (trustDevice) {
      await this.audit.record({
        ctx: { ...ctx, userId: user.id, sessionId: session.sessionId },
        action: 'auth.device.trusted',
        resourceType: 'trusted_device',
        resourceId: trustedDeviceToken ?? 'unknown',
        changes: null,
      });
    }

    // Best-effort new-device alert. Sending failure mustn't block
    // login, but it gets logged.
    this.email
      .sendNewDeviceAlert(user.email, {
        firstName: user.firstName,
        deviceLabel: session.sessionId ? labelForCtx(ctx.userAgent) : 'Klient i panjohur',
        ipAddressMasked: maskIp(ctx.ipAddress),
        whenFormatted: formatWhen(new Date()),
      })
      .catch((err: unknown) => {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err), userId: user.id },
          'New-device alert email failed',
        );
      });

    return {
      sessionToken: session.rawToken,
      sessionExpiresAt: session.expiresAt,
      userId: user.id,
      clinicId: user.clinicId,
      role: user.role,
      trustedDeviceToken,
      trustedDeviceExpiresAt,
    };
  }

  /** Re-issue a fresh code, marking the previous one expired. */
  async resendMfa(pendingSessionId: string, ctx: RequestContext): Promise<{ maskedEmail: string }> {
    const pending = await this.mfa.findPending(pendingSessionId);
    if (!pending) {
      throw new BadRequestException('Sesioni i verifikimit nuk u gjet.');
    }
    if (pending.consumedAt) {
      throw new BadRequestException('Kodi është verifikuar tashmë.');
    }
    if (pending.clinicId !== ctx.clinicId) {
      throw new ForbiddenException('Sesioni i pavlefshëm për këtë klinikë.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: pending.userId } });
    if (!user || !user.isActive) {
      throw new BadRequestException('Përdoruesi nuk është aktiv.');
    }

    await this.mfa.expirePending(pendingSessionId);
    const fresh = await this.mfa.issue(
      pending.userId,
      pending.clinicId,
      { rememberDevice: pending.rememberDevice, extendedTtl: pending.extendedTtl },
      ctx,
    );
    await this.email.sendMfaCode(user.email, {
      firstName: user.firstName,
      code: fresh.rawCode,
      ttlMinutes: Math.round((fresh.expiresAt.getTime() - Date.now()) / MS_PER_MINUTE),
    });
    await this.audit.record({
      ctx: { ...ctx, userId: user.id },
      action: 'auth.mfa.sent',
      resourceType: 'mfa_code',
      resourceId: fresh.pendingSessionId,
      changes: null,
    });
    return { maskedEmail: maskEmail(user.email) };
  }

  /**
   * Request a password-reset email. Always responds with a generic
   * success message so the response can't be used to enumerate
   * registered emails. Rate-limited at the controller layer.
   */
  async requestPasswordReset(email: string, ctx: RequestContext): Promise<void> {
    const emailLower = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: emailLower } });

    // The clinic check is critical: a user from clinic A asking for
    // reset on `klinikab.klinika.health` should NOT receive an email.
    // Cross-tenant enumeration would also leak the existence of the
    // user account.
    if (!user || !user.isActive || user.deletedAt || (ctx.clinicId && user.clinicId !== ctx.clinicId)) {
      this.logger.info(
        { ctx: { clinicId: ctx.clinicId, ipAddress: ctx.ipAddress } },
        'Password reset requested for unknown or out-of-tenant email',
      );
      return;
    }

    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * MS_PER_MINUTE);
    await this.prisma.authPasswordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: ctx.ipAddress,
      },
    });

    const baseUrl = process.env['WEB_BASE_URL'] ?? buildBaseUrl(ctx);
    const resetUrl = `${baseUrl}/reset-password?t=${encodeURIComponent(rawToken)}`;
    await this.email.sendPasswordReset(user.email, {
      firstName: user.firstName,
      resetUrl,
      ttlMinutes: PASSWORD_RESET_TTL_MINUTES,
    });
    await this.audit.record({
      ctx: { ...ctx, userId: user.id, sessionId: 'password_reset_request' },
      action: 'auth.password.reset.requested',
      resourceType: 'password_reset',
      resourceId: user.id,
      changes: null,
    });
  }

  /**
   * Consume a password reset token and set a new password. The
   * password is checked against the same strength rules as
   * registration and against haveibeenpwned (k-anonymity API).
   * Successful reset revokes every existing session for the user.
   */
  async confirmPasswordReset(token: string, newPassword: string, ctx: RequestContext): Promise<void> {
    this.assertPasswordPolicy(newPassword);
    const pwned = await this.passwords.isPwned(newPassword);
    if (pwned) {
      throw new BadRequestException('Fjalëkalimi është gjetur në lista publike. Zgjidhni një tjetër.');
    }

    const tokenHash = hashToken(token);
    const row = await this.prisma.authPasswordResetToken.findUnique({ where: { tokenHash } });
    if (!row) throw new BadRequestException('Lidhja nuk është e vlefshme.');
    if (row.consumedAt) throw new BadRequestException('Lidhja është përdorur tashmë.');
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Lidhja ka skaduar. Kërkoni një tjetër.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.isActive || user.deletedAt) {
      throw new BadRequestException('Përdoruesi nuk është aktiv.');
    }

    const hash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } }),
      this.prisma.authPasswordResetToken.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password_reset' },
      }),
    ]);
    await this.audit.record({
      ctx: { ...ctx, userId: user.id, sessionId: 'password_reset_confirm', clinicId: user.clinicId },
      action: 'auth.password.changed',
      resourceType: 'user',
      resourceId: user.id,
      changes: null,
    });
  }

  /** In-session password change. Requires the current password. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const verified = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!verified) {
      throw new BadRequestException('Fjalëkalimi aktual është i pasaktë.');
    }
    this.assertPasswordPolicy(newPassword);
    if (currentPassword === newPassword) {
      throw new BadRequestException('Fjalëkalimi i ri duhet të jetë i ndryshëm.');
    }
    const pwned = await this.passwords.isPwned(newPassword);
    if (pwned) {
      throw new BadRequestException('Fjalëkalimi është gjetur në lista publike. Zgjidhni një tjetër.');
    }

    const hash = await this.passwords.hash(newPassword);
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

    await this.audit.record({
      ctx,
      action: 'auth.password.changed',
      resourceType: 'user',
      resourceId: user.id,
      changes: null,
    });
  }

  async getUserProfile(userId: string): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    title: string | null;
    clinicName: string;
    clinicShortName: string;
    createdAt: Date;
    lastLoginAt: Date | null;
  }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { clinic: { select: { name: true, shortName: true } } },
    });
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      title: user.title,
      clinicName: user.clinic.name,
      clinicShortName: user.clinic.shortName,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  async recordAttempt(
    emailLower: string,
    ctx: Pick<RequestContext, 'ipAddress' | 'userAgent'>,
    success: boolean,
    reason: string | null,
  ): Promise<void> {
    await this.prisma.authLoginAttempt.create({
      data: {
        emailLower,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent ?? '',
        success,
        reason,
      },
    });
  }

  private assertPasswordPolicy(password: string): void {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new BadRequestException(`Fjalëkalimi duhet të jetë të paktën ${MIN_PASSWORD_LENGTH} karaktere.`);
    }
    const strength = this.passwords.evaluateStrength(password);
    if (!ACCEPTABLE_STRENGTHS.has(strength)) {
      throw new BadRequestException('Fjalëkalimi është shumë i dobët.');
    }
  }
}

// Sentinel argon2id hash for a fixed never-used password — verifying
// against this takes the same time as a real verify, so a non-existent
// account doesn't return faster than a wrong-password attempt.
const SENTINEL_ARGON_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$cnUgaXMgdGhlIHNlbnRpbmVs$Lx2nQzG7uG3KCM/0LZbgVZ9b5N0RZyT8eiWnW7CqWec';

function labelForCtx(userAgent: string | undefined): string {
  if (!userAgent) return 'Klient i panjohur';
  // Avoid pulling in ua-parser at this depth — the session row
  // already carries a parsed label; this is just the email-rendering
  // form, which we keep short.
  if (userAgent.includes('Chrome')) return 'Chrome';
  if (userAgent.includes('Safari')) return 'Safari';
  if (userAgent.includes('Firefox')) return 'Firefox';
  if (userAgent.includes('Edg')) return 'Edge';
  return 'Klient i panjohur';
}

function formatWhen(when: Date): string {
  // dd.MM.yyyy · HH:mm in Europe/Belgrade per CLAUDE.md §5.6.
  const fmt = new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(when);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} · ${get('hour')}:${get('minute')}`;
}

function buildBaseUrl(ctx: RequestContext): string {
  if (ctx.clinicSubdomain) {
    return `https://${ctx.clinicSubdomain}.klinika.health`;
  }
  return 'https://klinika.health';
}

// Re-export the LoginResponse type for the controller side. The DTO
// module defines the wire shape; the service constructs it.
export type { LoginResponse };
