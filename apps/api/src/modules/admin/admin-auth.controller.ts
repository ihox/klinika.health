import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { serialize } from 'cookie';
import type { Response } from 'express';

import { AllowAnonymous } from '../../common/decorators/allow-anonymous.decorator';
import { Ctx } from '../../common/decorators/ctx.decorator';
import { AdminScope } from '../../common/decorators/allow-anonymous.decorator';
import { extractCookie } from '../../common/guards/auth.guard';
import type { RequestContext, RequestWithContext } from '../../common/request-context/request-context';
import { RATE_LIMITS, RateLimitService } from '../rate-limit/rate-limit.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { ADMIN_SESSION_COOKIE_NAME, AdminSessionService } from './admin-session.service';
import {
  AdminLoginRequestSchema,
  AdminMfaResendRequestSchema,
  AdminMfaVerifyRequestSchema,
} from './admin.dto';
import { PlatformAuditService } from './platform-audit.service';

const COOKIE_DEFAULTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
};

function cookieIsSecure(): boolean {
  return process.env['NODE_ENV'] === 'production';
}

@Controller('api/admin/auth')
@AdminScope()
@UseGuards(AdminAuthGuard)
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly sessions: AdminSessionService,
    private readonly rateLimit: RateLimitService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Post('login')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{
    status: 'mfa_required' | 'authenticated';
    pendingSessionId?: string;
    maskedEmail?: string;
  }> {
    const parsed = AdminLoginRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Të dhëna të pavlefshme.', issues: parsed.error.flatten() });
    }

    // Same rate limits as the tenant login flow. Platform admins are
    // few in number; we still want the per-IP throttle to slow down
    // an attacker who's discovered admin.klinika.health.
    await this.rateLimit.consume(RATE_LIMITS.loginIp, ctx.ipAddress);
    await this.rateLimit.consume(RATE_LIMITS.loginEmail, parsed.data.email);

    const result = await this.auth.beginLogin(parsed.data.email, parsed.data.password, ctx);
    if (result.status === 'mfa_required') {
      return {
        status: 'mfa_required',
        pendingSessionId: result.pendingSessionId,
        maskedEmail: result.maskedEmail,
      };
    }
    return { status: 'authenticated' };
  }

  @Post('mfa/verify')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async mfaVerify(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'authenticated' }> {
    const parsed = AdminMfaVerifyRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Të dhëna të pavlefshme.', issues: parsed.error.flatten() });
    }
    await this.rateLimit.consume(RATE_LIMITS.mfaVerify, parsed.data.pendingSessionId);
    const out = await this.auth.verifyMfa(parsed.data.pendingSessionId, parsed.data.code, ctx);
    res.setHeader(
      'Set-Cookie',
      serialize(ADMIN_SESSION_COOKIE_NAME, out.sessionToken, {
        ...COOKIE_DEFAULTS,
        secure: cookieIsSecure(),
        expires: out.sessionExpiresAt,
      }),
    );
    return { status: 'authenticated' };
  }

  @Post('mfa/resend')
  @AllowAnonymous()
  @HttpCode(HttpStatus.OK)
  async mfaResend(@Body() body: unknown, @Ctx() ctx: RequestContext): Promise<{ maskedEmail: string }> {
    const parsed = AdminMfaResendRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({ message: 'Të dhëna të pavlefshme.', issues: parsed.error.flatten() });
    }
    await this.rateLimit.consume(RATE_LIMITS.mfaSend, parsed.data.pendingSessionId);
    return this.auth.resendMfa(parsed.data.pendingSessionId, ctx);
  }

  @Get('me')
  async me(@Ctx() ctx: RequestContext): Promise<{
    admin: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      lastLoginAt: string | null;
      createdAt: string;
    };
  }> {
    if (!ctx.userId) {
      throw new UnauthorizedException();
    }
    const profile = await this.auth.getProfile(ctx.userId);
    return {
      admin: {
        id: profile.id,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        lastLoginAt: profile.lastLoginAt?.toISOString() ?? null,
        createdAt: profile.createdAt.toISOString(),
      },
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: RequestWithContext,
    @Res({ passthrough: true }) res: Response,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok' }> {
    const token = extractCookie(req.headers['cookie'], ADMIN_SESSION_COOKIE_NAME);
    if (token) {
      await this.sessions.revokeByToken(token, 'admin_logout');
    }
    res.setHeader(
      'Set-Cookie',
      serialize(ADMIN_SESSION_COOKIE_NAME, '', {
        ...COOKIE_DEFAULTS,
        secure: cookieIsSecure(),
        expires: new Date(0),
        maxAge: 0,
      }),
    );
    if (ctx.userId && ctx.sessionId) {
      await this.audit.record({
        ctx: {
          platformAdminId: ctx.userId,
          sessionId: ctx.sessionId,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
        action: 'admin.logout',
        resourceType: 'admin_session',
        resourceId: ctx.sessionId,
      });
    }
    return { status: 'ok' };
  }
}
