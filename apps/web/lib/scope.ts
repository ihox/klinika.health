/**
 * Frontend mirror of `apps/api/src/common/middleware/clinic-resolution.middleware.ts`
 *
 * Classifies the request host into one of four scopes. The Next.js
 * middleware runs this once per request and forwards the result as
 * the `x-klinika-scope` header so server components can pick it up
 * without re-parsing the host themselves.
 *
 * Defense in depth: the API enforces the same boundary independently
 * — this is the routing layer.
 */

export type ScopeKind = 'platform' | 'tenant' | 'reserved' | 'unknown';

export interface ResolvedScope {
  kind: ScopeKind;
  subdomain: string | null;
}

const RESERVED_HOST_PREFIXES = new Set([
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

const SUBDOMAIN_SHAPE = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** Classify a hostname (lowercase, port-stripped) into a request scope. */
export function classifyHost(rawHost: string | null | undefined): ResolvedScope {
  const host = (rawHost ?? '').toLowerCase();
  const withoutPort = host.split(':')[0] ?? host;

  if (
    withoutPort === '' ||
    withoutPort === 'localhost' ||
    withoutPort === 'klinika.health' ||
    withoutPort === 'app.klinika.health'
  ) {
    return { kind: 'platform', subdomain: null };
  }

  if (withoutPort.endsWith('.localhost')) {
    const sub = withoutPort.slice(0, -'.localhost'.length);
    if (!sub) return { kind: 'platform', subdomain: null };
    if (RESERVED_HOST_PREFIXES.has(sub)) {
      return { kind: 'reserved', subdomain: sub };
    }
    if (SUBDOMAIN_SHAPE.test(sub)) {
      return { kind: 'tenant', subdomain: sub };
    }
    return { kind: 'reserved', subdomain: sub };
  }

  if (withoutPort.endsWith('.klinika.health')) {
    const sub = withoutPort.slice(0, -'.klinika.health'.length);
    if (!sub) return { kind: 'platform', subdomain: null };
    if (RESERVED_HOST_PREFIXES.has(sub)) {
      return { kind: 'reserved', subdomain: sub };
    }
    if (SUBDOMAIN_SHAPE.test(sub)) {
      return { kind: 'tenant', subdomain: sub };
    }
    return { kind: 'reserved', subdomain: sub };
  }

  // Unrelated host (someone pointing their own domain at us).
  return { kind: 'reserved', subdomain: withoutPort };
}

/**
 * Paths that belong to the clinic surface — accepted on tenant scope,
 * 404'd on platform scope. Anchored with `/` so `/admin` doesn't
 * accidentally match `/administrative-thing` if we ever add one.
 */
export const CLINIC_PATH_PREFIXES = [
  '/doctor',
  '/receptionist',
  '/cilesimet',
  '/pacient',
  '/pacientet',
  '/pamja-e-dites',
  '/profili-im',
  '/verify',
  '/forgot-password',
  '/reset-password',
  '/suspended',
];

/**
 * Paths that belong to the platform-admin surface — accepted on
 * platform scope, 404'd on tenant scope.
 */
export const PLATFORM_PATH_PREFIXES = ['/admin'];

export function pathStartsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  for (const prefix of prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}
