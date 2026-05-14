import { describe, expect, it } from 'vitest';

import { resolveSubdomain } from './clinic-resolution.middleware';

describe('resolveSubdomain', () => {
  it.each([
    ['donetamed.klinika.health', { kind: 'tenant', subdomain: 'donetamed' }],
    ['demo.klinika.health:3000', { kind: 'tenant', subdomain: 'demo' }],
    ['admin.klinika.health', { kind: 'admin', subdomain: null }],
    ['klinika.health', { kind: 'apex', subdomain: null }],
    ['app.klinika.health', { kind: 'apex', subdomain: null }],
    ['localhost', { kind: 'localhost', subdomain: null }],
    ['localhost:3000', { kind: 'localhost', subdomain: null }],
    // *.localhost is the dev-time mirror of *.klinika.health so the
    // subdomain routing can be exercised without /etc/hosts gymnastics
    // for every tenant.
    ['admin.localhost', { kind: 'admin', subdomain: null }],
    ['admin.localhost:3000', { kind: 'admin', subdomain: null }],
    ['donetamed.localhost', { kind: 'tenant', subdomain: 'donetamed' }],
    ['donetamed.localhost:3000', { kind: 'tenant', subdomain: 'donetamed' }],
    ['other-domain.com', { kind: 'apex', subdomain: null }],
    // Lowercase-only subdomain regex enforced by the middleware; the
    // caller is expected to lowercase the host before passing it in
    // (which the middleware does — this test simulates that).
  ])('host=%s → %j', (host, expected) => {
    expect(resolveSubdomain(host.toLowerCase(), null)).toEqual(expected);
  });

  it('honours the X-Clinic-Subdomain override on localhost', () => {
    expect(resolveSubdomain('localhost:3000', 'donetamed')).toEqual({
      kind: 'tenant',
      subdomain: 'donetamed',
    });
  });
});
