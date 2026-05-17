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

/**
 * Default production apex. Overridden per-environment via the
 * `CLINIC_HOST_SUFFIX` env var (suffix mode) or
 * `CLINIC_HOST_APEX` + `CLINIC_HOST_PREFIX` (prefix mode — staging).
 * See the matching API-side comment on `HostResolutionConfig` in
 * `apps/api/src/common/middleware/clinic-resolution.middleware.ts`
 * and ADR-018 for the two-mode rationale.
 */
const DEFAULT_HOST_SUFFIX = 'klinika.health';

/** Two-mode host-resolution config. Mirrors the API-side interface. */
export interface HostResolutionConfig {
  /** Suffix mode apex (e.g. `klinika.health`). Falls back to the default. */
  suffix?: string;
  /** Prefix mode apex FQDN (e.g. `klinika-health.ihox.net`). */
  apex?: string;
  /** Prefix mode tenant prefix (e.g. `klinika-health-`). */
  prefix?: string;
}

const ENV =
  typeof process !== 'undefined' && process.env ? process.env : ({} as Record<string, string | undefined>);

/**
 * Module-level host resolution config — resolved once when this file
 * is first loaded by `next dev` or the standalone production server.
 * Both pick up the env vars from the runtime environment. Exported
 * so callers and tests can introspect what mode this process is in.
 */
export const CLINIC_HOST_CONFIG: Required<HostResolutionConfig> = {
  suffix: ENV['CLINIC_HOST_SUFFIX'] || DEFAULT_HOST_SUFFIX,
  apex: ENV['CLINIC_HOST_APEX'] || '',
  prefix: ENV['CLINIC_HOST_PREFIX'] || '',
};

/** Back-compat shim — the suffix used in suffix mode (production). */
export const CLINIC_HOST_SUFFIX = CLINIC_HOST_CONFIG.suffix;

/** Classify a hostname (lowercase, port-stripped) into a request scope. */
export function classifyHost(
  rawHost: string | null | undefined,
  config: HostResolutionConfig | string = CLINIC_HOST_CONFIG,
): ResolvedScope {
  const cfg: HostResolutionConfig =
    typeof config === 'string' ? { suffix: config } : config;
  const hostPrefix = (cfg.prefix ?? '').toLowerCase();
  const hostApex = (cfg.apex ?? '').toLowerCase();
  // Accept the suffix with or without a leading dot — both
  // `klinika.health` and `.klinika.health` should behave the same.
  const hostSuffix = (cfg.suffix ?? DEFAULT_HOST_SUFFIX).toLowerCase().replace(/^\./, '');

  const host = (rawHost ?? '').toLowerCase();
  const withoutPort = host.split(':')[0] ?? host;

  // localhost is always platform (dev convenience), mode-agnostic.
  if (withoutPort === '' || withoutPort === 'localhost') {
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

  // Prefix mode — apex is a fixed FQDN, tenants are sibling FQDNs
  // sharing the apex's parent domain and a hyphen-joined prefix.
  // Active when both apex + prefix are configured.
  if (hostApex && hostPrefix) {
    if (withoutPort === hostApex) {
      return { kind: 'platform', subdomain: null };
    }
    const apexDotIdx = hostApex.indexOf('.');
    if (apexDotIdx > 0) {
      const parentDomain = hostApex.slice(apexDotIdx + 1);
      const parentSuffix = `.${parentDomain}`;
      if (
        withoutPort.startsWith(hostPrefix) &&
        withoutPort.endsWith(parentSuffix)
      ) {
        const sub = withoutPort.slice(
          hostPrefix.length,
          withoutPort.length - parentSuffix.length,
        );
        if (!sub) return { kind: 'reserved', subdomain: '' };
        if (RESERVED_HOST_PREFIXES.has(sub)) {
          return { kind: 'reserved', subdomain: sub };
        }
        if (SUBDOMAIN_SHAPE.test(sub)) {
          return { kind: 'tenant', subdomain: sub };
        }
        return { kind: 'reserved', subdomain: sub };
      }
    }
    return { kind: 'reserved', subdomain: withoutPort };
  }

  // Suffix mode (production).
  if (withoutPort === hostSuffix || withoutPort === `app.${hostSuffix}`) {
    return { kind: 'platform', subdomain: null };
  }
  const apexDotted = `.${hostSuffix}`;
  if (withoutPort.endsWith(apexDotted)) {
    const sub = withoutPort.slice(0, -apexDotted.length);
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
