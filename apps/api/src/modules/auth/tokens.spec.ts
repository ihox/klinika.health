import { describe, expect, it } from 'vitest';

import { generateNumericCode, generateOpaqueToken, hashToken, secureEqualHex } from './tokens';

describe('tokens', () => {
  describe('generateOpaqueToken', () => {
    it('produces URL-safe base64 strings of the expected length', () => {
      const t = generateOpaqueToken();
      // 32 bytes → base64url ≈ 43 chars (no padding).
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(t.length).toBeGreaterThanOrEqual(43);
    });

    it('produces distinct values across calls', () => {
      const a = generateOpaqueToken();
      const b = generateOpaqueToken();
      expect(a).not.toBe(b);
    });
  });

  describe('hashToken', () => {
    it('is deterministic SHA-256', () => {
      expect(hashToken('hello')).toBe(hashToken('hello'));
      expect(hashToken('hello')).not.toBe(hashToken('Hello'));
    });

    it('outputs 64 hex chars', () => {
      expect(hashToken('hello')).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('secureEqualHex', () => {
    it('returns true for identical hex strings', () => {
      expect(secureEqualHex('deadbeef', 'deadbeef')).toBe(true);
    });
    it('returns false for length mismatch', () => {
      expect(secureEqualHex('deadbeef', 'deadbe')).toBe(false);
    });
    it('returns false for different hex strings', () => {
      expect(secureEqualHex('deadbeef', '11111111')).toBe(false);
    });
    it('does not throw on non-hex input', () => {
      // Node's Buffer.from('zzzz', 'hex') silently treats invalid hex
      // as the empty buffer; both inputs decode equal so the call
      // returns true. The important contract is "no throw, returns a
      // bool" — strict hex validation isn't this helper's job.
      expect(() => secureEqualHex('zzzz', 'zzzz')).not.toThrow();
    });
  });

  describe('generateNumericCode', () => {
    it('returns a 6-digit string by default', () => {
      const c = generateNumericCode();
      expect(c).toMatch(/^\d{6}$/);
    });

    it('zero-pads short values', () => {
      // Run many samples; at least one is likely to need padding.
      let sawPadded = false;
      for (let i = 0; i < 200; i += 1) {
        const c = generateNumericCode(6);
        expect(c).toHaveLength(6);
        if (c.startsWith('0')) sawPadded = true;
      }
      // With 200 samples the probability of never starting with 0 is ~10^-9.
      expect(sawPadded).toBe(true);
    });

    it('rejects out-of-range digit counts', () => {
      expect(() => generateNumericCode(0)).toThrow();
      expect(() => generateNumericCode(11)).toThrow();
    });

    it('distribution is roughly uniform', () => {
      const counts = new Map<number, number>();
      for (let i = 0; i < 1_000; i += 1) {
        const first = Number(generateNumericCode(1));
        counts.set(first, (counts.get(first) ?? 0) + 1);
      }
      // No digit appears in fewer than 50 or more than 200 samples.
      for (let d = 0; d <= 9; d += 1) {
        const c = counts.get(d) ?? 0;
        expect(c).toBeGreaterThan(50);
        expect(c).toBeLessThan(200);
      }
    });
  });
});
