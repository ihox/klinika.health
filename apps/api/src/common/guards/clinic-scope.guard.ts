import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RequestWithContext } from '../request-context/request-context';
import { ALLOW_ANONYMOUS_METADATA_KEY } from './auth.guard';

export const ADMIN_SCOPE_METADATA_KEY = 'klinika:admin-scope';

/**
 * Asserts that the request has a resolved clinic context. Bypassed
 * for handlers tagged `@AdminScope()` (platform admin routes which
 * legitimately span clinics).
 *
 * Defense-in-depth check: the AuthGuard already requires a session
 * which carries a clinic_id, but for endpoints reachable
 * anonymously (login, password reset, MFA) we still need the
 * subdomain to be known so we can scope the database lookup. Running
 * this guard after AuthGuard catches the case where a session got
 * issued for a different clinic than the current host (token theft
 * across tenants).
 */
@Injectable()
export class ClinicScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const adminScope = this.reflector.getAllAndOverride<boolean | undefined>(
      ADMIN_SCOPE_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    const allowAnonymous = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_ANONYMOUS_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    const req = executionContext.switchToHttp().getRequest<RequestWithContext>();
    const ctx = req.ctx;
    if (!ctx) {
      throw new ForbiddenException('Pa kontekst kërkese.');
    }

    if (adminScope) {
      if (!ctx.isAdminScope) {
        throw new ForbiddenException('Vetëm për administratorin e platformës.');
      }
      return true;
    }

    if (!ctx.clinicId) {
      if (allowAnonymous) {
        // Login from apex (klinika.health/login) is rejected here —
        // login must be performed on the clinic's own subdomain so
        // we know which tenant the user belongs to. The error wording
        // surfaces in the browser as a useful redirect target.
        throw new ForbiddenException('Hyrja kërkon nëndomenin e klinikës.');
      }
      throw new ForbiddenException('Klinika nuk u njoh.');
    }

    if (ctx.clinicStatus === 'suspended') {
      // Suspended clinics keep their data but reject every request —
      // login, authenticated traffic, password reset — until a
      // platform admin reactivates. The error code lets the web
      // layer redirect to `/suspended` instead of showing a generic
      // 403. Active sessions are also revoked at suspension time
      // (admin-tenants.service), so an in-flight session can't carry
      // a user past this guard.
      throw new ForbiddenException({
        reason: 'clinic_suspended',
        message: 'Klinika juaj është pezulluar. Kontaktoni adminin.',
      });
    }

    if (ctx.userId && req.userId && ctx.clinicId !== req.clinicId) {
      throw new ForbiddenException('Përshtatja klinikë/sesion është e pavlefshme.');
    }

    return true;
  }
}
