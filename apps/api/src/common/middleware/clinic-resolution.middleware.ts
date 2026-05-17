import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Response, NextFunction } from 'express';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { buildBaseContext, type RequestWithContext } from '../request-context/request-context';

/**
 * Default production apex. Overridden per-environment via the
 * `CLINIC_HOST_SUFFIX` env var (e.g. staging uses
 * `klinika.health.ihox.net`). The middleware reads the env once on
 * construction and passes the resolved suffix to {@link resolveScope}.
 */
const DEFAULT_HOST_SUFFIX = 'klinika.health';

/**
 * Subdomains reserved for the platform's own infrastructure. Tenants
 * are forbidden from claiming these (see `subdomain-validation.ts`),
 * AND requests targeting them are rejected at the edge — they never
 * resolve to a clinic, never resolve to platform scope, just 400.
 *
 * Notably `admin` is here: under the boundary model (ADR-005 fix,
 * 2026-05-14), the platform-admin context lives at the apex domain
 * only, not on a dedicated `admin.*` subdomain. Hitting
 * `admin.klinika.health` is invalid the same way `mail.klinika.health`
 * is invalid.
 */
const RESERVED_HOST_PREFIXES: ReadonlySet<string> = new Set([
  'admin',
  'www',
  'api',
  'mail',
  'support',
  'status',
  'help',
  'docs',
  'static',
  'cdn',
  'auth',
  'login',
  'staging',
  'test',
  'dev',
  'internal',
]);

export type ResolvedScope =
  | { kind: 'platform' }
  | { kind: 'tenant'; subdomain: string }
  | { kind: 'reserved'; subdomain: string }
  | { kind: 'unknown'; subdomain: string };

/**
 * Resolve the request scope from the Host header on every request,
 * before any guards run.
 *
 *   - `klinika.health`, `app.klinika.health`, or bare `localhost`
 *     → platform scope (apex). Only `/api/admin/*` routes accept these.
 *   - `donetamed.klinika.health` / `donetamed.localhost` → tenant
 *     scope, resolves to the matching clinic's id.
 *   - `admin.klinika.health`, `www.*`, `api.*`, … → rejected with 400
 *     (`reserved`). The platform never serves an app under these
 *     hosts.
 *   - `<sub>.klinika.health` where `<sub>` matches the subdomain
 *     shape but no clinic exists → 404 (`unknown`). Returns
 *     `{ reason: 'clinic_not_found', message: 'Klinika nuk u gjet.' }`.
 *
 * Sets `req.ctx` for downstream consumers and also `req.clinicId` /
 * `req.userId` (the latter cleared, filled by AuthGuard) so the Pino
 * logger picks them up via its `customProps` hook.
 *
 * Localhost flows (`localhost:3000`) honour an `X-Clinic-Subdomain`
 * header so e2e tests can target a specific tenant without DNS
 * gymnastics. Production strips the header (Caddy doesn't forward it).
 */
@Injectable()
export class ClinicResolutionMiddleware implements NestMiddleware {
  private readonly hostSuffix: string;

  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ClinicResolutionMiddleware.name)
    private readonly logger: PinoLogger,
  ) {
    this.hostSuffix = process.env['CLINIC_HOST_SUFFIX'] || DEFAULT_HOST_SUFFIX;
  }

  async use(req: RequestWithContext, res: Response, next: NextFunction): Promise<void> {
    const ctx = buildBaseContext(req);
    req.ctx = ctx;

    // Behind a trusted proxy (Caddy in prod, the Next.js dev-server
    // rewrite in development) the original Host travels in
    // X-Forwarded-Host while `Host` reflects the upstream. Prefer the
    // forwarded value when present so subdomain routing keeps working.
    // `trust proxy` is set in main.ts, so we only honour this header
    // from sources Express recognises as trusted.
    const forwardedHost = req.headers['x-forwarded-host'];
    const forwardedHostStr = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
    const rawHost = (forwardedHostStr ?? req.headers['host'] ?? '').toString();
    const host = rawHost.toLowerCase();
    const overrideHeader = req.headers['x-clinic-subdomain'];
    const override = typeof overrideHeader === 'string' ? overrideHeader.toLowerCase() : null;

    const resolved = resolveScope(host, override, this.hostSuffix);

    if (resolved.kind === 'reserved') {
      this.logger.warn(
        { subdomain: resolved.subdomain, requestId: ctx.requestId },
        'Rejected request targeting reserved subdomain',
      );
      res.status(400).json({
        reason: 'reserved_subdomain',
        message: 'Subdomain i rezervuar.',
      });
      return;
    }

    if (resolved.kind === 'platform') {
      ctx.isPlatform = true;
      next();
      return;
    }

    // Tenant scope. Look up the clinic and either continue (active /
    // suspended — let the guard decide) or 404 if it doesn't exist.
    const clinic = await this.lookupClinicBySubdomain(resolved.subdomain);
    if (!clinic) {
      this.logger.warn(
        { subdomain: resolved.subdomain, requestId: ctx.requestId },
        'Unknown clinic subdomain',
      );
      res.status(404).json({
        reason: 'clinic_not_found',
        message: 'Klinika nuk u gjet.',
      });
      return;
    }
    ctx.isPlatform = false;
    ctx.clinicId = clinic.id;
    ctx.clinicSubdomain = resolved.subdomain;
    ctx.clinicStatus = clinic.status;
    req.clinicId = clinic.id;

    next();
  }

  // Public so the AuthService can reuse it during admin login (where
  // there's no clinic to resolve from the host).
  async lookupClinicBySubdomain(
    subdomain: string,
  ): Promise<{ id: string; status: 'active' | 'suspended' } | null> {
    // RLS on `clinics` only returns rows matching `app.clinic_id`, so
    // we issue raw SQL that runs without setting that GUC. In dev the
    // database user is BYPASSRLS by default; production deployments
    // provision a dedicated `klinika_app` role with a `subdomain_lookup`
    // policy — tracked in docs/architecture.md.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; status: string }>
    >(
      'SELECT id::text AS id, status::text AS status FROM clinics WHERE subdomain = $1 AND deleted_at IS NULL LIMIT 1',
      subdomain,
    );
    const row = rows[0];
    if (!row) return null;
    return { id: row.id, status: row.status as 'active' | 'suspended' };
  }
}

/**
 * Pure host → scope classifier. Exported for unit tests and for the
 * frontend middleware which mirrors this logic.
 *
 * `hostSuffix` is the apex domain for this environment — `klinika.health`
 * in production, `klinika.health.ihox.net` in staging. Defaults to the
 * production suffix so existing callers (test fixtures, dev shells)
 * keep working without changes.
 */
export function resolveScope(
  host: string,
  override: string | null,
  hostSuffix: string = DEFAULT_HOST_SUFFIX,
): ResolvedScope {
  const hostWithoutPort = host.split(':')[0] ?? host;
  const apex = hostSuffix.toLowerCase();
  const apexDotted = `.${apex}`;

  // Localhost override (dev / E2E) — explicit, takes precedence over
  // anything the Host header carries. Honoured as a tenant subdomain
  // so tests can target a specific clinic without DNS gymnastics.
  if (override) {
    if (RESERVED_HOST_PREFIXES.has(override)) {
      return { kind: 'reserved', subdomain: override };
    }
    if (/^[a-z0-9][a-z0-9-]{0,40}$/.test(override)) {
      return { kind: 'tenant', subdomain: override };
    }
    return { kind: 'reserved', subdomain: override };
  }

  // Apex hosts — platform scope. `app.${apex}` historically served
  // the marketing page; treat it as platform too so the boundary
  // stays apex-only.
  if (
    hostWithoutPort === 'localhost' ||
    hostWithoutPort === apex ||
    hostWithoutPort === `app.${apex}`
  ) {
    return { kind: 'platform' };
  }

  // `*.localhost` — dev-time mirror of `*.${apex}` so subdomain-driven
  // clinic routing works without `/etc/hosts` edits for every tenant.
  if (hostWithoutPort.endsWith('.localhost')) {
    const sub = hostWithoutPort.slice(0, -'.localhost'.length);
    if (!sub) return { kind: 'platform' };
    if (RESERVED_HOST_PREFIXES.has(sub)) {
      return { kind: 'reserved', subdomain: sub };
    }
    if (/^[a-z0-9][a-z0-9-]{0,40}$/.test(sub)) {
      return { kind: 'tenant', subdomain: sub };
    }
    // Malformed subdomain — treat as reserved (rejected at the edge)
    // rather than silently falling through to platform.
    return { kind: 'reserved', subdomain: sub };
  }

  // Production / staging tenant subdomains under the configured apex.
  if (hostWithoutPort.endsWith(apexDotted)) {
    const sub = hostWithoutPort.slice(0, -apexDotted.length);
    if (!sub) return { kind: 'platform' };
    if (RESERVED_HOST_PREFIXES.has(sub)) {
      return { kind: 'reserved', subdomain: sub };
    }
    if (/^[a-z0-9][a-z0-9-]{0,40}$/.test(sub)) {
      return { kind: 'tenant', subdomain: sub };
    }
    return { kind: 'reserved', subdomain: sub };
  }

  // Unknown host (e.g. someone pointing their own domain at us). Don't
  // give it platform scope — that would expose admin endpoints. 400
  // makes it explicit at the edge.
  return { kind: 'reserved', subdomain: hostWithoutPort };
}

/** Back-compat export so internal callers don't break before they migrate. */
export const resolveSubdomain = resolveScope;
