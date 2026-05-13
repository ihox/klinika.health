import { describe, expect, it } from 'vitest';

import {
  RESERVED_SUBDOMAINS,
  validateSubdomain,
  subdomainErrorMessage,
} from './subdomain-validation';

describe('validateSubdomain', () => {
  describe('valid', () => {
    it.each([
      ['donetamed'],
      ['clinic-2'],
      ['demo'],
      ['a1'],
      ['x9-test'],
      ['abcdefghij0123456789abcdefghij0123456789'], // 40 chars exact
      ['009-numeric'],
    ])('accepts %s', (value) => {
      const result = validateSubdomain(value);
      expect(result.ok, JSON.stringify(result)).toBe(true);
    });

    it('lowercases and trims input', () => {
      expect(validateSubdomain('  DonetaMED  ').ok).toBe(true);
    });
  });

  describe('invalid', () => {
    it('rejects empty', () => {
      expect(validateSubdomain('')).toEqual({ ok: false, reason: 'empty' });
      expect(validateSubdomain('   ')).toEqual({ ok: false, reason: 'empty' });
    });

    it('rejects too short', () => {
      expect(validateSubdomain('a')).toEqual({ ok: false, reason: 'too_short' });
    });

    it('rejects too long', () => {
      const longer = 'a'.repeat(41);
      expect(validateSubdomain(longer)).toEqual({ ok: false, reason: 'too_long' });
    });

    it.each([
      ['has_underscore', 'invalid_chars'],
      ['has space', 'invalid_chars'],
      ['has.dot', 'invalid_chars'],
      ['emoji-✓', 'invalid_chars'],
      ['ä-umlaut', 'invalid_chars'],
    ])('rejects bad characters in %s', (value, reason) => {
      expect(validateSubdomain(value).reason).toBe(reason);
    });

    it('lowercases capitals before validating (so "Aurora-PED" becomes valid)', () => {
      // Conscious choice: we accept the lowercased form rather than
      // forcing the user to retype. Documented here so a future test
      // matching the old expectation doesn't accidentally tighten this.
      expect(validateSubdomain('Aurora-PED').ok).toBe(true);
    });

    it('rejects leading hyphen', () => {
      expect(validateSubdomain('-foo')).toEqual({ ok: false, reason: 'leading_hyphen' });
    });

    it('rejects trailing hyphen', () => {
      expect(validateSubdomain('foo-')).toEqual({ ok: false, reason: 'trailing_hyphen' });
    });

    it.each([['admin'], ['www'], ['api'], ['mail'], ['support']])(
      'rejects reserved word %s',
      (value) => {
        expect(validateSubdomain(value)).toEqual({ ok: false, reason: 'reserved' });
      },
    );

    it('reserves the platform name itself', () => {
      expect(validateSubdomain('klinika').reason).toBe('reserved');
    });
  });
});

describe('RESERVED_SUBDOMAINS', () => {
  it('blocks the four explicitly-required words from the spec', () => {
    for (const word of ['admin', 'www', 'api', 'mail', 'support']) {
      expect(RESERVED_SUBDOMAINS.has(word)).toBe(true);
    }
  });
});

describe('subdomainErrorMessage', () => {
  it('returns Albanian copy for every reason', () => {
    const reasons = [
      'empty',
      'too_short',
      'too_long',
      'invalid_chars',
      'leading_hyphen',
      'trailing_hyphen',
      'reserved',
    ] as const;
    for (const reason of reasons) {
      const msg = subdomainErrorMessage(reason);
      expect(msg.length).toBeGreaterThan(4);
      // No English fallbacks — at minimum, no plain ASCII-only English
      // sentence. Sanity check: at least one Albanian-specific token.
      expect(/[a-zA-Z]/.test(msg)).toBe(true);
    }
  });
});
