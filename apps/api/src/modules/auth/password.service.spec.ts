import type { PinoLogger } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordService } from './password.service';

function makeNoopLogger(): PinoLogger {
  return {
    warn: () => undefined,
    info: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    setContext: () => undefined,
    assign: () => undefined,
  } as unknown as PinoLogger;
}

describe('PasswordService', () => {
  const service = new PasswordService(makeNoopLogger());

  describe('hash + verify', () => {
    it('hashes a password and verifies the same plaintext', async () => {
      const hash = await service.hash('correct-horse-battery-staple');
      expect(hash).toMatch(/^\$argon2id\$/);
      const ok = await service.verify(hash, 'correct-horse-battery-staple');
      expect(ok).toBe(true);
    });

    it('rejects a wrong password against a real hash', async () => {
      const hash = await service.hash('correct-horse-battery-staple');
      const ok = await service.verify(hash, 'wrong-password-here');
      expect(ok).toBe(false);
    });

    it('returns false instead of throwing on a malformed hash', async () => {
      const ok = await service.verify('not-a-real-hash', 'anything');
      expect(ok).toBe(false);
    });
  });

  describe('evaluateStrength', () => {
    it.each([
      ['', 'empty'],
      ['abc', 'weak'],
      ['abc123', 'weak'],
      ['abc12345', 'fair'],
      ['abc123def!', 'medium'],
      ['Abc123def!XY', 'strong'],
      ['Abc123def!XY-longer-pw', 'very_strong'],
    ])('%s → %s', (input, expected) => {
      expect(service.evaluateStrength(input)).toBe(expected);
    });

    it('isStrongEnough rejects short passwords even if varied', () => {
      expect(service.isStrongEnough('Ab1!')).toBe(false);
    });

    it('isStrongEnough accepts medium-or-better at min length', () => {
      expect(service.isStrongEnough('abc123def!')).toBe(true);
    });
  });

  describe('isPwned (mocked fetch)', () => {
    const realFetch = globalThis.fetch;

    beforeEach(() => {
      // Replace global fetch for each test
    });
    afterEach(() => {
      globalThis.fetch = realFetch;
      vi.restoreAllMocks();
    });

    it('returns true when the suffix appears in the response', async () => {
      // SHA1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
      // prefix: 5BAA6, suffix: 1E4C9B93F3F0682250B6CF8331B7EE68FD8
      const stub = vi.fn(async (input: unknown) => {
        const url = typeof input === 'string' ? input : (input as URL).toString();
        expect(url).toContain('5BAA6');
        return {
          ok: true,
          status: 200,
          text: async () =>
            '0018A45C4D1DEF81644B54AB7F969B88D65:1\n' +
            '1E4C9B93F3F0682250B6CF8331B7EE68FD8:42\n',
        } as Response;
      });
      globalThis.fetch = stub as typeof fetch;

      const pwned = await service.isPwned('password');
      expect(pwned).toBe(true);
      expect(stub).toHaveBeenCalledOnce();
    });

    it('returns false when no suffix matches', async () => {
      globalThis.fetch = (async () =>
        ({
          ok: true,
          status: 200,
          text: async () => '0018A45C4D1DEF81644B54AB7F969B88D65:1\n',
        }) as Response) as typeof fetch;

      const pwned = await service.isPwned('this-was-never-pwned-i-hope-xx');
      expect(pwned).toBe(false);
    });

    it('soft-fails on network error', async () => {
      globalThis.fetch = (async () => {
        throw new Error('network down');
      }) as typeof fetch;
      const pwned = await service.isPwned('whatever');
      expect(pwned).toBe(false);
    });
  });
});
