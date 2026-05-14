import type { Request } from 'express';

import type { AppRole } from '../decorators/roles.decorator';

/**
 * Per-request context populated by the middleware/guard chain:
 *
 *   1. `ClinicResolutionMiddleware` parses the Host header and decides
 *      whether the request is in PLATFORM scope (apex domain — only
 *      platform admins live here) or CLINIC scope (tenant subdomain —
 *      where the clinic's doctors / receptionists / clinic admins
 *      live). Reserved subdomains and unknown subdomains are rejected
 *      before any handler runs.
 *   2. `AuthGuard` / `AdminAuthGuard` validate the session cookie and
 *      set `userId`, `roles`, `sessionId`.
 *   3. Controllers receive the context via the `@Ctx()` decorator
 *      and pass it into services so query scoping is uniform.
 *
 * Platform vs clinic boundary (CLAUDE.md §1, ADR-005):
 *   - `isPlatform = true` AND `clinicId = null` → apex domain
 *     (klinika.health / localhost in dev). Only platform-admin
 *     endpoints accept these requests.
 *   - `isPlatform = false` AND `clinicId = <uuid>` → tenant subdomain.
 *     Only clinic endpoints accept these requests.
 *   - These are mutually exclusive — never set both, never neither.
 *
 * `roles` (ADR-004 Multi-role update): for an authenticated clinic
 * session this is the user's `users.roles` array (subset of
 * {doctor, receptionist, clinic_admin}); for an admin session it is
 * `['platform_admin']` set by `AdminAuthGuard`; for anonymous
 * traffic it is `null`. Authorization checks use array membership
 * (`ctx.roles?.includes('doctor')` or the helpers in
 * `role-helpers.ts`).
 *
 * `ipAddress` and `userAgent` are filled by the middleware regardless
 * of auth state so the audit log and login-attempt tracking work for
 * anonymous traffic too.
 */
export interface RequestContext {
  clinicId: string | null;
  clinicSubdomain: string | null;
  clinicStatus: 'active' | 'suspended' | null;
  userId: string | null;
  roles: AppRole[] | null;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  isPlatform: boolean;
}

export type RequestWithContext = Request & {
  ctx?: RequestContext;
  userId?: string;
  clinicId?: string;
};

export function buildBaseContext(req: RequestWithContext): RequestContext {
  return {
    clinicId: null,
    clinicSubdomain: null,
    clinicStatus: null,
    userId: null,
    roles: null,
    sessionId: null,
    ipAddress: extractIp(req),
    userAgent: (req.headers['user-agent'] ?? '').toString().slice(0, 512),
    requestId: extractRequestId(req),
    isPlatform: false,
  };
}

function extractIp(req: Request): string {
  // Behind Caddy / Cloudflare Tunnel we trust the leftmost entry of
  // X-Forwarded-For. Outside containers (local dev), fall back to the
  // socket address. `::ffff:` IPv4-mapped IPv6 prefixes are stripped
  // so the value fits Postgres INET cleanly.
  const xff = req.headers['x-forwarded-for'];
  let raw: string | undefined;
  if (typeof xff === 'string') {
    raw = xff.split(',')[0]?.trim();
  } else if (Array.isArray(xff) && xff.length > 0) {
    raw = xff[0];
  }
  raw ??= req.socket.remoteAddress ?? '127.0.0.1';
  return raw.replace(/^::ffff:/, '');
}

function extractRequestId(req: Request): string {
  const h = req.headers['x-request-id'];
  if (typeof h === 'string') return h;
  if (Array.isArray(h) && h[0]) return h[0];
  // nestjs-pino assigns one if missing; this fallback only hits if
  // we're reading the context before the logger middleware ran.
  return 'unset';
}
