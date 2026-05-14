import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { RequestWithContext } from '../request-context/request-context';
import { ALLOW_ANONYMOUS_METADATA_KEY } from './auth.guard';

export const PLATFORM_SCOPE_METADATA_KEY = 'klinika:platform-scope';

/**
 * Generic "Email-i ose fjalëkalimi është i pasaktë" — the SAME string
 * used for wrong password, wrong email, wrong scope (platform admin
 * on subdomain or vice versa), and any other failure that would
 * otherwise leak whether an account exists in a different context.
 *
 * Keeping this constant in one place (and identical to the message
 * thrown by AuthService / AdminAuthService) is part of the boundary's
 * security guarantee: a response from the API gives an attacker no
 * signal about whether they hit the right domain.
 */
export const GENERIC_INVALID_CREDENTIALS_MESSAGE = 'Email-i ose fjalëkalimi është i pasaktë.';

/**
 * Asserts that the request scope matches the handler's contract.
 *
 * - `@PlatformScope()` handlers require apex (`ctx.isPlatform === true`).
 *   On a tenant subdomain they return the generic 401, so a clinic
 *   user can't tell the route exists somewhere else.
 * - Default (no decorator): the handler expects clinic scope. Tenant
 *   subdomain only; platform requests get the generic 401 unless they
 *   are `@AllowAnonymous()` (in which case scope just isn't enforced
 *   here — login endpoints handle it themselves).
 * - Suspended clinics get a dedicated 403 with `reason:
 *   clinic_suspended` so the web layer can redirect to `/suspended`.
 *   We surface this BEFORE the boundary check because a suspended
 *   tenant still has a clinic record and we want the operator to know
 *   they need to reactivate, not to think the URL is broken.
 */
@Injectable()
export class ClinicScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const platformScope = this.reflector.getAllAndOverride<boolean | undefined>(
      PLATFORM_SCOPE_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    const allowAnonymous = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_ANONYMOUS_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    const req = executionContext.switchToHttp().getRequest<RequestWithContext>();
    const ctx = req.ctx;
    if (!ctx) {
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    if (platformScope) {
      if (!ctx.isPlatform) {
        // Tenant subdomain hitting a platform-only handler. Generic 401
        // — never reveal that this route exists at apex.
        throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
      }
      return true;
    }

    // Clinic-scope handler.
    if (ctx.isPlatform) {
      if (allowAnonymous) {
        // Apex login / password-reset / health probe hitting the
        // clinic auth controller. Generic 401 so the response is
        // indistinguishable from a wrong-password attempt — no scope
        // leak.
        throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
      }
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    if (!ctx.clinicId) {
      // Middleware should have either set this or rejected with 404 —
      // belt-and-braces.
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    if (ctx.clinicStatus === 'suspended') {
      // Suspended clinics keep their data but reject every request —
      // login, authenticated traffic, password reset — until a
      // platform admin reactivates. Active sessions are also revoked
      // at suspension time (admin-tenants.service), so an in-flight
      // session can't carry a user past this guard.
      //
      // 403 with a dedicated `reason` is intentional here — unlike the
      // boundary-leak case, "your clinic is suspended" is a state the
      // operator already knows about, and the web layer needs the
      // signal to redirect to `/suspended` instead of /login.
      throw new ForbiddenException({
        reason: 'clinic_suspended',
        message: 'Klinika juaj është pezulluar. Kontaktoni adminin.',
      });
    }

    if (ctx.userId && req.userId && ctx.clinicId !== req.clinicId) {
      // Session was issued for a different clinic than the current
      // host. Same generic 401 — never reveal which clinic the
      // session belongs to.
      throw new UnauthorizedException(GENERIC_INVALID_CREDENTIALS_MESSAGE);
    }

    return true;
  }
}
