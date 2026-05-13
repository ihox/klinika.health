/**
 * Subdomain validation rules for tenant creation.
 *
 * Format constraints (CLAUDE.md §3 conventions + Caddy/DNS realities):
 *   - lowercase a-z, digits 0-9, hyphen only
 *   - must start with a letter or digit (no leading hyphen — RFC 1035)
 *   - must end with a letter or digit (no trailing hyphen)
 *   - 2..40 characters (length cap matches the regex in
 *     ClinicResolutionMiddleware.resolveSubdomain so a clinic that
 *     was accepted on creation will always resolve later)
 *
 * Reserved words protect the platform's own host space. Any future
 * subdomain that the platform serves directly (marketing pages,
 * status, API surface, mail providers) belongs here so a tenant can't
 * grab it.
 */

export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'admin',
  'www',
  'api',
  'mail',
  'support',
  'app',
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
  'klinika',
]);

const SUBDOMAIN_FORMAT = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const MIN_LENGTH = 2;
const MAX_LENGTH = 40;

export type SubdomainValidationError =
  | 'empty'
  | 'too_short'
  | 'too_long'
  | 'invalid_chars'
  | 'leading_hyphen'
  | 'trailing_hyphen'
  | 'reserved';

export interface SubdomainValidationResult {
  ok: boolean;
  reason?: SubdomainValidationError;
}

export function validateSubdomain(raw: string): SubdomainValidationResult {
  const value = raw.trim().toLowerCase();
  if (value.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (value.length < MIN_LENGTH) {
    return { ok: false, reason: 'too_short' };
  }
  if (value.length > MAX_LENGTH) {
    return { ok: false, reason: 'too_long' };
  }
  if (value.startsWith('-')) {
    return { ok: false, reason: 'leading_hyphen' };
  }
  if (value.endsWith('-')) {
    return { ok: false, reason: 'trailing_hyphen' };
  }
  if (!SUBDOMAIN_FORMAT.test(value)) {
    return { ok: false, reason: 'invalid_chars' };
  }
  if (RESERVED_SUBDOMAINS.has(value)) {
    return { ok: false, reason: 'reserved' };
  }
  return { ok: true };
}

/** Albanian-language message for a validation reason, suitable for UI surfacing. */
export function subdomainErrorMessage(reason: SubdomainValidationError): string {
  switch (reason) {
    case 'empty':
      return 'Subdomain mungon.';
    case 'too_short':
      return 'Subdomain duhet të jetë të paktën 2 karaktere.';
    case 'too_long':
      return 'Subdomain duhet të jetë më i shkurtër se 40 karaktere.';
    case 'invalid_chars':
      return 'Vetëm shkronja të vogla a–z, shifra 0–9 dhe vizë.';
    case 'leading_hyphen':
      return 'Subdomain nuk mund të fillojë me vizë.';
    case 'trailing_hyphen':
      return 'Subdomain nuk mund të mbarojë me vizë.';
    case 'reserved':
      return 'Ky subdomain është i rezervuar.';
  }
}
