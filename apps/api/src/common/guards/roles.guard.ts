import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_METADATA_KEY, type AppRole } from '../decorators/roles.decorator';
import type { RequestWithContext } from '../request-context/request-context';
import { extractCookie } from './auth.guard';
import { SessionService, SESSION_COOKIE_NAME } from '../../modules/auth/session.service';
import {
  ADMIN_SESSION_COOKIE_NAME,
  AdminSessionService,
} from '../../modules/admin/admin-session.service';

/**
 * Enforces `@Roles(...)` metadata on a handler.
 *
 * RolesGuard is registered as a global APP_GUARD so any controller can
 * tag a handler with `@Roles('doctor')` and skip wiring boilerplate.
 * Nest runs global guards BEFORE controller-scoped ones, which means
 * by the time we get called the per-controller AuthGuard /
 * AdminAuthGuard has not yet hydrated `ctx.role`. To avoid spurious
 * 403s ("Roli juaj nuk ka qasje në këtë veprim") we re-validate the
 * session here just enough to set `ctx.role`. AuthGuard / AdminAuthGuard
 * still run after us to do the rest of the work (touch `last_used_at`,
 * set userId / sessionId / clinicId on the request).
 *
 * A request that hits a `@Roles`-protected route therefore pays for
 * one extra session lookup. That's acceptable: the alternative is
 * touching every controller to move the guard wiring around.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly adminSessions: AdminSessionService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(
      ROLES_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    const req = executionContext.switchToHttp().getRequest<RequestWithContext>();
    const ctx = req.ctx;
    if (!ctx) {
      throw new ForbiddenException('Roli juaj nuk ka qasje në këtë veprim.');
    }

    if (!ctx.role) {
      await this.hydrateRole(req);
    }

    if (!ctx.role || !required.includes(ctx.role)) {
      throw new ForbiddenException('Roli juaj nuk ka qasje në këtë veprim.');
    }
    return true;
  }

  private async hydrateRole(req: RequestWithContext): Promise<void> {
    const ctx = req.ctx;
    if (!ctx) return;
    const cookieHeader = req.headers['cookie'];

    if (ctx.isPlatform) {
      const token = extractCookie(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
      if (!token) return;
      const session = await this.adminSessions.validate(token, ctx);
      if (!session) return;
      ctx.role = 'platform_admin';
      return;
    }

    const token = extractCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!token) return;
    const session = await this.sessions.validate(token, ctx);
    if (!session) return;
    ctx.role = session.role;
  }
}
