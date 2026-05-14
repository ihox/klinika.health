import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { SessionService, SESSION_COOKIE_NAME } from '../../modules/auth/session.service';
import type { RequestWithContext } from '../request-context/request-context';
import { GENERIC_INVALID_CREDENTIALS_MESSAGE } from './clinic-scope.guard';

export const ALLOW_ANONYMOUS_METADATA_KEY = 'klinika:allow-anonymous';

/**
 * Validates the clinic session cookie, hydrates `req.ctx` with the
 * authenticated user, and updates `auth_sessions.last_used_at`.
 *
 * Handlers tagged with `@AllowAnonymous()` bypass — used for login,
 * password reset, and the public health endpoints.
 *
 * Boundary enforcement: a clinic session cookie presented on the apex
 * domain (platform scope) is rejected here with the generic 401, so
 * that copying a klinika_session cookie from a tenant subdomain to
 * apex doesn't authenticate a clinic user against the platform admin
 * surface.
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
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    if (ctx.isPlatform) {
      // Clinic session presented on the apex domain — never valid.
      // The cookie may have been copied across hosts; respond as if
      // it doesn't exist so an attacker can't tell whether a session
      // is alive elsewhere.
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
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

    if (ctx.clinicId && session.clinicId !== ctx.clinicId) {
      // Session was issued for a different clinic than the current
      // host. Generic 401 — don't tell the caller which clinic.
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    ctx.userId = session.userId;
    ctx.roles = session.roles;
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
