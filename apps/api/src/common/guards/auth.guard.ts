import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SessionService, SESSION_COOKIE_NAME } from '../../modules/auth/session.service';
import type { RequestWithContext } from '../request-context/request-context';

export const ALLOW_ANONYMOUS_METADATA_KEY = 'klinika:allow-anonymous';

/**
 * Validates the session cookie, hydrates `req.ctx` with the
 * authenticated user, and updates `auth_sessions.last_used_at`.
 *
 * Handlers tagged with `@AllowAnonymous()` bypass — used for login,
 * password reset, and the public health endpoints.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const allowAnonymous = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_ANONYMOUS_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    const req = executionContext.switchToHttp().getRequest<RequestWithContext>();
    if (allowAnonymous) {
      return true;
    }

    const ctx = req.ctx;
    if (!ctx) {
      throw new UnauthorizedException('Pa kontekst kërkese.');
    }

    const cookieHeader = req.headers['cookie'];
    const token = extractCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!token) {
      throw new UnauthorizedException('Nuk jeni i kyçur.');
    }

    const session = await this.sessions.validate(token, ctx);
    if (!session) {
      throw new UnauthorizedException('Sesioni ka skaduar.');
    }

    ctx.userId = session.userId;
    ctx.role = session.role;
    ctx.sessionId = session.sessionId;
    if (!ctx.clinicId) {
      ctx.clinicId = session.clinicId;
    }
    req.userId = session.userId;
    req.clinicId = session.clinicId;
    return true;
  }
}

export function extractCookie(header: string | string[] | undefined, name: string): string | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header.join('; ') : header;
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const k = trimmed.slice(0, eq);
    if (k === name) {
      return decodeURIComponent(trimmed.slice(eq + 1));
    }
  }
  return null;
}
