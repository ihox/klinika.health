import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { serialize } from 'cookie';
import type { Response } from 'express';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { Ctx } from '../../common/decorators/ctx.decorator';
import { AllowAnonymous } from '../../common/decorators/allow-anonymous.decorator';
import { AuthGuard, extractCookie } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext, RequestWithContext } from '../../common/request-context/request-context';
import { RateLimitService, RATE_LIMITS } from '../rate-limit/rate-limit.service';
import { AuthService } from './auth.service';
import {
  LoginRequestSchema,
  MfaResendRequestSchema,
  MfaVerifyRequestSchema,
  PasswordChangeSchema,
  PasswordResetConfirmSchema,
  PasswordResetRequestSchema,
  PasswordStrengthRequestSchema,
  RevokeSessionSchema,
  RevokeTrustedDeviceSchema,
} from './auth.dto';
import { PasswordService } from './password.service';
import { SESSION_COOKIE_NAME, SessionService } from './session.service';
import { TRUSTED_DEVICE_COOKIE_NAME, TrustedDeviceService } from './trusted-device.service';

const COOKIE_DEFAULTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
};

function cookieIsSecure(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

@Controller('api/auth')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly trustedDevices: TrustedDeviceService,
    private readonly rateLimit: RateLimitService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditLogService,
  ) {}

  /**
   * GET /api/auth/clinic-identity — public, returns the resolved
   * clinic's display name + short name for the current host. The
   * host-aware login page calls this to render "Klinika · {Clinic
   * Name}" without hardcoding any tenant identifier in the frontend
   * bundle. Returns 404 on apex / platform scope (ClinicScopeGuard
   * surfaces this as the generic 401).
   */
  @Get('clinic-identity')
  @AllowAnonymous()
  async clinicIdentity(@Ctx() ctx: RequestContext): Promise<{
    subdomain: string;
    name: string;
    shortName: string;
  }> {
    if (!ctx.clinicId || !ctx.clinicSubdomain) {
      throw new BadRequestException('Klinika nuk u gjet.');
    }
    return this.auth.getClinicIdentity(ctx.clinicId);
  }

  /** POST /api/auth/login — email + password. May return mfa_required. */
  @Post('login')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @Ctx() ctx: RequestContext,
  ): Promise<{
    status: 'mfa_required' | 'authenticated';
    pendingSessionId?: string;
    maskedEmail?: string;
    roles?: string[];
  }> {
    const parsed = LoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }

    await this.rateLimit.consume(RATE_LIMITS.loginIp, ctx.ipAddress);
    await this.rateLimit.consume(RATE_LIMITS.loginEmail, parsed.data.email);

    const trustedCookie = extractCookie(req.headers['cookie'], TRUSTED_DEVICE_COOKIE_NAME);
    const result = await this.auth.beginLogin(parsed.data, trustedCookie, ctx);

    if (result.status === 'authenticated') {
      this.setSessionCookie(res, result.sessionToken, result.sessionExpiresAt);
      return { status: 'authenticated', roles: result.roles };
    }
    return {
      status: 'mfa_required',
      pendingSessionId: result.pendingSessionId,
      maskedEmail: result.maskedEmail,
    };
  }

  /** POST /api/auth/mfa/verify — 6-digit code from email. */
  @Post('mfa/verify')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async mfaVerify(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
    @Ctx() ctx: RequestContext,
  ): Promise<{ roles: string[] }> {
    const parsed = MfaVerifyRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }

    await this.rateLimit.consume(RATE_LIMITS.mfaVerify, parsed.data.pendingSessionId);

    const out = await this.auth.verifyMfa(
      parsed.data.pendingSessionId,
      parsed.data.code,
      parsed.data.trustDevice,
      ctx,
    );
    this.setSessionCookie(res, out.sessionToken, out.sessionExpiresAt);
    if (out.trustedDeviceToken && out.trustedDeviceExpiresAt) {
      this.setTrustedDeviceCookie(res, out.trustedDeviceToken, out.trustedDeviceExpiresAt);
    }
    return { roles: out.roles };
  }

  /** POST /api/auth/mfa/resend — re-issue the code. */
  @Post('mfa/resend')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async mfaResend(@Body() body: unknown, @Ctx() ctx: RequestContext): Promise<{ maskedEmail: string }> {
    const parsed = MfaResendRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    await this.rateLimit.consume(RATE_LIMITS.mfaSend, parsed.data.pendingSessionId);
    return this.auth.resendMfa(parsed.data.pendingSessionId, ctx);
  }

  /** POST /api/auth/password-reset/request — send reset email. */
  @Post('password-reset/request')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok' }> {
    const parsed = PasswordResetRequestSchema.safeParse(body);
    if (!parsed.success) {
      // Don't leak the validation issues — same generic response as
      // a known email, to prevent enumeration.
      return { status: 'ok' };
    }
    await this.rateLimit.consume(RATE_LIMITS.passwordResetRequest, parsed.data.email);
    await this.auth.requestPasswordReset(parsed.data.email, ctx);
    return { status: 'ok' };
  }

  /** POST /api/auth/password-reset/confirm — set new password. */
  @Post('password-reset/confirm')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async confirmPasswordReset(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok' }> {
    const parsed = PasswordResetConfirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    await this.auth.confirmPasswordReset(parsed.data.token, parsed.data.newPassword, ctx);
    return { status: 'ok' };
  }

  /** POST /api/auth/password-strength — synchronous strength preview. */
  @Post('password-strength')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  passwordStrength(@Body() body: unknown): {
    strength: 'empty' | 'weak' | 'fair' | 'medium' | 'strong' | 'very_strong';
    acceptable: boolean;
  } {
    const parsed = PasswordStrengthRequestSchema.safeParse(body);
    if (!parsed.success) {
      return { strength: 'empty', acceptable: false };
    }
    const strength = this.passwords.evaluateStrength(parsed.data.password);
    return { strength, acceptable: this.passwords.isStrongEnough(parsed.data.password) };
  }

  /** GET /api/auth/me — profile + session metadata for the user menu. */
  @Get('me')
  async me(@Ctx() ctx: RequestContext): Promise<{
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      roles: string[];
      title: string | null;
      clinicName: string;
      clinicShortName: string;
      createdAt: string;
      lastLoginAt: string | null;
    };
  }> {
    if (!ctx.userId || !ctx.clinicId) {
      throw new BadRequestException();
    }
    const profile = await this.auth.getUserProfile(ctx.userId);
    return {
      user: {
        ...profile,
        createdAt: profile.createdAt.toISOString(),
        lastLoginAt: profile.lastLoginAt?.toISOString() ?? null,
      },
    };
  }

  /** GET /api/auth/sessions — for the profile page. */
  @Get('sessions')
  async listSessions(@Ctx() ctx: RequestContext): Promise<{ sessions: Array<Record<string, unknown>> }> {
    if (!ctx.userId || !ctx.sessionId) throw new BadRequestException();
    const list = await this.sessions.list(ctx.userId, ctx.sessionId);
    return {
      sessions: list.map((s) => ({
        id: s.id,
        deviceLabel: s.deviceLabel,
        ipAddress: s.ipAddress,
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
        isCurrent: s.isCurrent,
        extendedTtl: s.extendedTtl,
      })),
    };
  }

  /** GET /api/auth/trusted-devices — for the profile page. */
  @Get('trusted-devices')
  async listTrustedDevices(
    @Req() req: RequestWithContext,
    @Ctx() ctx: RequestContext,
  ): Promise<{ devices: Array<Record<string, unknown>> }> {
    if (!ctx.userId || !ctx.clinicId) throw new BadRequestException();
    const cookie = extractCookie(req.headers['cookie'], TRUSTED_DEVICE_COOKIE_NAME);
    let currentId: string | null = null;
    if (cookie) {
      const td = await this.trustedDevices.findValid(cookie);
      if (td && td.userId === ctx.userId) currentId = td.id;
    }
    const list = await this.trustedDevices.list(ctx.userId, ctx.clinicId, currentId);
    return {
      devices: list.map((d) => ({
        id: d.id,
        label: d.label,
        ipAddress: d.ipAddress,
        createdAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
        expiresAt: d.expiresAt.toISOString(),
        isCurrent: d.isCurrent,
      })),
    };
  }

  /** DELETE /api/auth/trusted-devices/:id — revoke one device. */
  @Delete('trusted-devices/:id')
  @HttpCode(HttpStatus.OK)
  async revokeTrustedDevice(
    @Param('id') id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok' }> {
    const parsed = RevokeTrustedDeviceSchema.safeParse({ deviceId: id });
    if (!parsed.success || !ctx.userId) {
      throw new BadRequestException('ID e pavlefshme.');
    }
    const removed = await this.trustedDevices.revoke(ctx.userId, parsed.data.deviceId, 'user_request');
    if (removed) {
      await this.audit.record({
        ctx,
        action: 'auth.device.revoked',
        resourceType: 'trusted_device',
        resourceId: parsed.data.deviceId,
        changes: null,
      });
    }
    return { status: 'ok' };
  }

  /** POST /api/auth/trusted-devices/revoke-all */
  @Post('trusted-devices/revoke-all')
  @HttpCode(HttpStatus.OK)
  async revokeAllTrustedDevices(
    @Res({ passthrough: true }) res: Response,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok'; count: number }> {
    if (!ctx.userId) throw new BadRequestException();
    const count = await this.trustedDevices.revokeAll(ctx.userId, 'user_revoke_all');
    this.clearCookie(res, TRUSTED_DEVICE_COOKIE_NAME);
    if (count > 0) {
      await this.audit.record({
        ctx,
        action: 'auth.device.revoked',
        resourceType: 'trusted_device',
        resourceId: 'all',
        changes: null,
      });
    }
    return { status: 'ok', count };
  }

  /** POST /api/auth/sessions/revoke-others */
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  async revokeOtherSessions(@Ctx() ctx: RequestContext): Promise<{ status: 'ok'; count: number }> {
    if (!ctx.userId || !ctx.sessionId) throw new BadRequestException();
    const count = await this.sessions.revokeAllExcept(ctx.userId, ctx.sessionId, 'user_request');
    if (count > 0) {
      await this.audit.record({
        ctx,
        action: 'auth.sessions.revoked',
        resourceType: 'session',
        resourceId: 'others',
        changes: null,
      });
    }
    return { status: 'ok', count };
  }

  /** DELETE /api/auth/sessions/:id — revoke a specific session (logout from one device). */
  @Delete('sessions/:id')
  @HttpCode(HttpStatus.OK)
  async revokeSession(@Param('id') id: string, @Ctx() ctx: RequestContext): Promise<{ status: 'ok' }> {
    const parsed = RevokeSessionSchema.safeParse({ sessionId: id });
    if (!parsed.success || !ctx.userId) throw new BadRequestException();
    if (parsed.data.sessionId === ctx.sessionId) {
      throw new BadRequestException('Përdorni "Dil" për të mbyllur këtë sesion.');
    }
    await this.sessions.revokeById(parsed.data.sessionId, 'user_request');
    await this.audit.record({
      ctx,
      action: 'auth.sessions.revoked',
      resourceType: 'session',
      resourceId: parsed.data.sessionId,
      changes: null,
    });
    return { status: 'ok' };
  }

  /** POST /api/auth/password-change — current+new. */
  @Post('password-change')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() body: unknown, @Ctx() ctx: RequestContext): Promise<{ status: 'ok' }> {
    const parsed = PasswordChangeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    if (!ctx.userId) throw new BadRequestException();
    await this.auth.changePassword(ctx.userId, parsed.data.currentPassword, parsed.data.newPassword, ctx);
    return { status: 'ok' };
  }

  /** POST /api/auth/logout — revoke session, clear cookies. */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok' }> {
    const token = extractCookie(req.headers['cookie'], SESSION_COOKIE_NAME);
    if (token) {
      await this.sessions.revokeByToken(token, 'user_logout');
    }
    this.clearCookie(res, SESSION_COOKIE_NAME);
    if (ctx.userId && ctx.sessionId) {
      await this.audit.record({
        ctx,
        action: 'auth.logout',
        resourceType: 'session',
        resourceId: ctx.sessionId,
        changes: null,
      });
    }
    return { status: 'ok' };
  }

  private setSessionCookie(res: Response, token: string, expires: Date): void {
    res.setHeader(
      'Set-Cookie',
      appendSetCookie(res.getHeader('Set-Cookie'), [
        serialize(SESSION_COOKIE_NAME, token, {
          ...COOKIE_DEFAULTS,
          secure: cookieIsSecure(),
          expires,
        }),
      ]),
    );
  }

  private setTrustedDeviceCookie(res: Response, token: string, expires: Date): void {
    res.setHeader(
      'Set-Cookie',
      appendSetCookie(res.getHeader('Set-Cookie'), [
        serialize(TRUSTED_DEVICE_COOKIE_NAME, token, {
          ...COOKIE_DEFAULTS,
          secure: cookieIsSecure(),
          expires,
        }),
      ]),
    );
  }

  private clearCookie(res: Response, name: string): void {
    res.setHeader(
      'Set-Cookie',
      appendSetCookie(res.getHeader('Set-Cookie'), [
        serialize(name, '', {
          ...COOKIE_DEFAULTS,
          secure: cookieIsSecure(),
          expires: new Date(0),
          maxAge: 0,
        }),
      ]),
    );
  }
}

function appendSetCookie(
  existing: number | string | string[] | undefined,
  additions: string[],
): string[] {
  if (existing === undefined) return additions;
  if (Array.isArray(existing)) return [...existing, ...additions];
  if (typeof existing === 'string') return [existing, ...additions];
  return additions;
}
