import { describe, expect, it } from 'vitest';

import { CLINIC_PATH_PREFIXES, PLATFORM_PATH_PREFIXES, classifyHost, pathStartsWithAny } from './scope';

describe('classifyHost', () => {
  it.each([
    ['klinika.health', 'platform'],
    ['app.klinika.health', 'platform'],
    ['localhost', 'platform'],
    ['localhost:3000', 'platform'],
    ['donetamed.klinika.health', 'tenant'],
    ['donetamed.localhost', 'tenant'],
    ['donetamed.localhost:3000', 'tenant'],
    ['demo.klinika.health:443', 'tenant'],
    ['admin.klinika.health', 'reserved'],
    ['admin.localhost', 'reserved'],
    ['www.klinika.health', 'reserved'],
    ['api.klinika.health', 'reserved'],
    ['mail.klinika.health', 'reserved'],
    ['support.klinika.health', 'reserved'],
    ['other-domain.com', 'reserved'],
    ['', 'platform'],
    [null, 'platform'],
    [undefined, 'platform'],
  ])('host=%j → kind=%s', (host, kind) => {
    expect(classifyHost(host).kind).toBe(kind);
  });

  it('extracts the subdomain for tenant scope', () => {
    expect(classifyHost('donetamed.klinika.health')).toEqual({
      kind: 'tenant',
      subdomain: 'donetamed',
    });
  });

  it('captures the reserved prefix so the middleware can log it', () => {
    expect(classifyHost('admin.klinika.health')).toEqual({
      kind: 'reserved',
      subdomain: 'admin',
    });
  });

  describe('with CLINIC_HOST_SUFFIX override (staging)', () => {
    const STAGING_SUFFIX = 'klinika.health.ihox.net';

    it('treats the staging apex as platform scope', () => {
      expect(classifyHost('klinika.health.ihox.net', STAGING_SUFFIX)).toEqual({
        kind: 'platform',
        subdomain: null,
      });
    });

    it('extracts a tenant subdomain under the staging suffix', () => {
      expect(classifyHost('clinic.klinika.health.ihox.net', STAGING_SUFFIX)).toEqual({
        kind: 'tenant',
        subdomain: 'clinic',
      });
    });

    it('rejects production hosts as unrelated when suffix is staging', () => {
      expect(classifyHost('donetamed.klinika.health', STAGING_SUFFIX)).toEqual({
        kind: 'reserved',
        subdomain: 'donetamed.klinika.health',
      });
    });

    it('still rejects reserved prefixes under the staging suffix', () => {
      expect(classifyHost('admin.klinika.health.ihox.net', STAGING_SUFFIX)).toEqual({
        kind: 'reserved',
        subdomain: 'admin',
      });
    });
  });

  describe('with CLINIC_HOST_APEX + CLINIC_HOST_PREFIX (staging prefix mode)', () => {
    const PREFIX_CONFIG = {
      apex: 'klinika-health.ihox.net',
      prefix: 'klinika-health-',
    };

    it('treats the apex as platform scope', () => {
      expect(classifyHost('klinika-health.ihox.net', PREFIX_CONFIG)).toEqual({
        kind: 'platform',
        subdomain: null,
      });
    });

    it('extracts the slug from a hyphen-joined tenant host', () => {
      expect(classifyHost('klinika-health-clinic.ihox.net', PREFIX_CONFIG)).toEqual({
        kind: 'tenant',
        subdomain: 'clinic',
      });
    });

    it('resolves donetamed as a tenant slug', () => {
      expect(classifyHost('klinika-health-donetamed.ihox.net', PREFIX_CONFIG)).toEqual({
        kind: 'tenant',
        subdomain: 'donetamed',
      });
    });

    it('strips the port from the apex host', () => {
      expect(classifyHost('klinika-health.ihox.net:443', PREFIX_CONFIG)).toEqual({
        kind: 'platform',
        subdomain: null,
      });
    });

    it('is case-insensitive on apex', () => {
      expect(classifyHost('KLINIKA-HEALTH.IHOX.NET', PREFIX_CONFIG)).toEqual({
        kind: 'platform',
        subdomain: null,
      });
    });

    it('rejects an empty slug between prefix and parent domain', () => {
      expect(classifyHost('klinika-health-.ihox.net', PREFIX_CONFIG)).toEqual({
        kind: 'reserved',
        subdomain: '',
      });
    });

    it('rejects a slug containing invalid characters', () => {
      expect(classifyHost('klinika-health-bad_slug.ihox.net', PREFIX_CONFIG)).toEqual({
        kind: 'reserved',
        subdomain: 'bad_slug',
      });
    });

    it('rejects a host that does not start with the prefix', () => {
      expect(classifyHost('not-klinika-health-clinic.ihox.net', PREFIX_CONFIG)).toEqual({
        kind: 'reserved',
        subdomain: 'not-klinika-health-clinic.ihox.net',
      });
    });

    it('rejects a host whose parent domain does not match the apex parent', () => {
      expect(classifyHost('klinika-health-clinic.different.com', PREFIX_CONFIG)).toEqual({
        kind: 'reserved',
        subdomain: 'klinika-health-clinic.different.com',
      });
    });

    it('still rejects reserved prefixes as a slug', () => {
      expect(classifyHost('klinika-health-admin.ihox.net', PREFIX_CONFIG)).toEqual({
        kind: 'reserved',
        subdomain: 'admin',
      });
    });
  });
});

describe('pathStartsWithAny', () => {
  it('matches exact path and child paths but not partial-word collisions', () => {
    expect(pathStartsWithAny('/admin', PLATFORM_PATH_PREFIXES)).toBe(true);
    expect(pathStartsWithAny('/admin/health', PLATFORM_PATH_PREFIXES)).toBe(true);
    expect(pathStartsWithAny('/administrative', PLATFORM_PATH_PREFIXES)).toBe(false);
    expect(pathStartsWithAny('/doctor', CLINIC_PATH_PREFIXES)).toBe(true);
    expect(pathStartsWithAny('/cilesimet/general', CLINIC_PATH_PREFIXES)).toBe(true);
    expect(pathStartsWithAny('/login', CLINIC_PATH_PREFIXES)).toBe(false);
  });
});
