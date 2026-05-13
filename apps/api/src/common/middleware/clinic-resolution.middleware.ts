import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Response, NextFunction } from 'express';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { buildBaseContext, type RequestWithContext } from '../request-context/request-context';

const ADMIN_HOST_PREFIX = 'admin.';
const SUBDOMAIN_HOST_SUFFIX = '.klinika.health';

interface ResolvedSubdomain {
  kind: 'tenant' | 'admin' | 'apex' | 'localhost';
  subdomain: string | null;
}

/**
 * Resolve the tenant clinic from the Host header on every request,
 * before any guards run.
 *
 *   - `donetamed.klinika.health` → clinic with subdomain `donetamed`
 *   - `admin.klinika.health` → platform-admin scope (no clinic)
 *   - `klinika.health` or `app.klinika.health` → apex marketing pages
 *     (read-only public endpoints only — most routes will reject)
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
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(ClinicResolutionMiddleware.name)
    private readonly logger: PinoLogger,
  ) {}

  async use(req: RequestWithContext, _res: Response, next: NextFunction): Promise<void> {
    const ctx = buildBaseContext(req);
    req.ctx = ctx;

    const host = (req.headers['host'] ?? '').toString().toLowerCase();
    const overrideHeader = req.headers['x-clinic-subdomain'];
    const override = typeof overrideHeader === 'string' ? overrideHeader.toLowerCase() : null;

    const resolved = resolveSubdomain(host, override);

    if (resolved.kind === 'admin') {
      ctx.isAdminScope = true;
      next();
      return;
    }

    if (resolved.kind === 'apex' || resolved.kind === 'localhost') {
      // No tenant context — apex or undecorated localhost. Many
      // routes will reject (ClinicScopeGuard), but health/auth-reset
      // can still respond.
      next();
      return;
    }

    if (!resolved.subdomain) {
      next();
      return;
    }

    const clinic = await this.lookupClinicBySubdomain(resolved.subdomain);
    if (clinic) {
      ctx.clinicId = clinic.id;
      ctx.clinicSubdomain = resolved.subdomain;
      req.clinicId = clinic.id;
    } else {
      this.logger.warn(
        { subdomain: resolved.subdomain, requestId: ctx.requestId },
        'Unknown clinic subdomain',
      );
    }

    next();
  }

  // Public so the AuthService can reuse it during admin login (where
  // the host is admin.klinika.health and there's no clinic to resolve).
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

export function resolveSubdomain(host: string, override: string | null): ResolvedSubdomain {
  if (override) {
    return { kind: 'tenant', subdomain: override };
  }
  const hostWithoutPort = host.split(':')[0] ?? host;
  if (hostWithoutPort === 'localhost' || hostWithoutPort.endsWith('.localhost')) {
    return { kind: 'localhost', subdomain: null };
  }
  if (hostWithoutPort === ADMIN_HOST_PREFIX + 'klinika.health'.replace(/^\./, '')) {
    return { kind: 'admin', subdomain: null };
  }
  if (hostWithoutPort.startsWith(ADMIN_HOST_PREFIX)) {
    return { kind: 'admin', subdomain: null };
  }
  if (hostWithoutPort === 'klinika.health' || hostWithoutPort === 'app.klinika.health') {
    return { kind: 'apex', subdomain: null };
  }
  if (hostWithoutPort.endsWith(SUBDOMAIN_HOST_SUFFIX)) {
    const sub = hostWithoutPort.slice(0, -SUBDOMAIN_HOST_SUFFIX.length);
    if (sub && /^[a-z0-9][a-z0-9-]{0,40}$/.test(sub)) {
      return { kind: 'tenant', subdomain: sub };
    }
  }
  return { kind: 'apex', subdomain: null };
}
