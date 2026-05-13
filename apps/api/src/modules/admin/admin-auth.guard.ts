import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ALLOW_ANONYMOUS_METADATA_KEY, extractCookie } from '../../common/guards/auth.guard';
import type { RequestWithContext } from '../../common/request-context/request-context';
import { ADMIN_SESSION_COOKIE_NAME, AdminSessionService } from './admin-session.service';

export type RequestWithAdminContext = RequestWithContext & {
  platformAdminId?: string;
  adminSessionId?: string;
};

/**
 * Validates the `klinika_admin_session` cookie and attaches the
 * platform-admin identity to the request. Unlike {@link AuthGuard}
 * this guard:
 *
 *   - reads a different cookie name (so tenant + admin sessions cannot
 *     be confused on the API),
 *   - sets `ctx.role = 'platform_admin'` and `ctx.userId =
 *     platformAdminId` so downstream `@Roles('platform_admin')` checks
 *     work uniformly,
 *   - does NOT populate `clinicId` (platform admins are cross-tenant),
 *
 * Pair with `@UseGuards(AdminAuthGuard)` and `@AdminScope()` on every
 * `/api/admin/*` controller. Use `@AllowAnonymous()` for the login /
 * MFA endpoints inside the admin auth controller.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: AdminSessionService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const allowAnonymous = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_ANONYMOUS_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    const req = executionContext.switchToHttp().getRequest<RequestWithAdminContext>();
    const ctx = req.ctx;
    if (!ctx) {
      throw new UnauthorizedException('Pa kontekst kërkese.');
    }

    if (!ctx.isAdminScope) {
      // Admin routes are only valid from admin.klinika.health (or
      // localhost with an explicit override). A tenant subdomain
      // hitting /api/admin/* is always wrong.
      throw new UnauthorizedException('Vetëm për administratorin e platformës.');
    }

    if (allowAnonymous) {
      return true;
    }

    const cookieHeader = req.headers['cookie'];
    const token = extractCookie(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException('Nuk jeni i kyçur.');
    }

    const session = await this.sessions.validate(token, ctx);
    if (!session) {
      throw new UnauthorizedException('Sesioni ka skaduar.');
    }

    ctx.userId = session.platformAdminId;
    ctx.role = 'platform_admin';
    ctx.sessionId = session.sessionId;
    req.userId = session.platformAdminId;
    req.platformAdminId = session.platformAdminId;
    req.adminSessionId = session.sessionId;
    return true;
  }
}
