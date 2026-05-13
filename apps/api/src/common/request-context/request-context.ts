import type { Request } from 'express';

/**
 * Per-request context populated by the middleware/guard chain:
 *
 *   1. `ClinicResolutionMiddleware` parses the Host header and sets
 *      `clinicId` (or marks the request as `/admin` scope, in which
 *      case `clinicId` is null and `platformAdmin` may be true).
 *   2. `AuthGuard` validates the session cookie and sets `userId`,
 *      `role`, `sessionId`.
 *   3. Controllers receive the context via the `@Ctx()` decorator
 *      and pass it into services so query scoping is uniform.
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
  role: 'doctor' | 'receptionist' | 'clinic_admin' | 'platform_admin' | null;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  isAdminScope: boolean;
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
    role: null,
    sessionId: null,
    ipAddress: extractIp(req),
    userAgent: (req.headers['user-agent'] ?? '').toString().slice(0, 512),
    requestId: extractRequestId(req),
    isAdminScope: false,
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
