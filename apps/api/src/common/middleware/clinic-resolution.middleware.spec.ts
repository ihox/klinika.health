import { describe, expect, it } from 'vitest';

import { resolveScope } from './clinic-resolution.middleware';

describe('resolveScope', () => {
  it.each([
    // Tenant subdomains — production + dev.
    ['donetamed.klinika.health', { kind: 'tenant', subdomain: 'donetamed' }],
    ['demo.klinika.health:3000', { kind: 'tenant', subdomain: 'demo' }],
    ['donetamed.localhost', { kind: 'tenant', subdomain: 'donetamed' }],
    ['donetamed.localhost:3000', { kind: 'tenant', subdomain: 'donetamed' }],
    // Apex — platform scope. Platform admins live here, never on a
    // dedicated admin subdomain.
    ['klinika.health', { kind: 'platform' }],
    ['app.klinika.health', { kind: 'platform' }],
    ['localhost', { kind: 'platform' }],
    ['localhost:3000', { kind: 'platform' }],
    // Reserved hosts get rejected at the edge — they never resolve to
    // platform OR to a tenant. The boundary is apex-only for platform
    // and explicit subdomains for tenants.
    ['admin.klinika.health', { kind: 'reserved', subdomain: 'admin' }],
    ['admin.localhost', { kind: 'reserved', subdomain: 'admin' }],
    ['admin.localhost:3000', { kind: 'reserved', subdomain: 'admin' }],
    ['www.klinika.health', { kind: 'reserved', subdomain: 'www' }],
    ['api.klinika.health', { kind: 'reserved', subdomain: 'api' }],
    ['mail.klinika.health', { kind: 'reserved', subdomain: 'mail' }],
    ['support.klinika.health', { kind: 'reserved', subdomain: 'support' }],
    // Unrelated hosts — rejected, never silently treated as platform.
    ['other-domain.com', { kind: 'reserved', subdomain: 'other-domain.com' }],
  ])('host=%s → %j', (host, expected) => {
    expect(resolveScope(host.toLowerCase(), null)).toEqual(expected);
  });

  it('honours the X-Clinic-Subdomain override on localhost', () => {
    expect(resolveScope('localhost:3000', 'donetamed')).toEqual({
      kind: 'tenant',
      subdomain: 'donetamed',
    });
  });

  it('rejects a reserved subdomain even when passed via override', () => {
    expect(resolveScope('localhost:3000', 'admin')).toEqual({
      kind: 'reserved',
      subdomain: 'admin',
    });
  });

  describe('with CLINIC_HOST_SUFFIX override (staging)', () => {
    const STAGING_SUFFIX = 'klinika.health.ihox.net';

    it('treats the staging apex as platform scope', () => {
      expect(resolveScope('klinika.health.ihox.net', null, STAGING_SUFFIX)).toEqual({
        kind: 'platform',
      });
    });

    it('extracts a tenant subdomain under the staging suffix', () => {
      expect(resolveScope('clinic.klinika.health.ihox.net', null, STAGING_SUFFIX)).toEqual({
        kind: 'tenant',
        subdomain: 'clinic',
      });
    });

    it('rejects production hosts as unrelated when suffix is staging', () => {
      // donetamed.klinika.health doesn't end with .klinika.health.ihox.net,
      // so it falls through to the unknown-host branch.
      expect(resolveScope('donetamed.klinika.health', null, STAGING_SUFFIX)).toEqual({
        kind: 'reserved',
        subdomain: 'donetamed.klinika.health',
      });
    });

    it('still rejects reserved prefixes under the staging suffix', () => {
      expect(resolveScope('admin.klinika.health.ihox.net', null, STAGING_SUFFIX)).toEqual({
        kind: 'reserved',
        subdomain: 'admin',
      });
    });
  });
});
