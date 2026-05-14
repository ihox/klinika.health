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
