import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 256-bit URL-safe random token. The raw value goes into the cookie
 * (or password-reset URL); the SHA-256 hash is stored in the DB. A
 * leaked database dump can't be replayed because the cookies are
 * gone, and a leaked cookie can't be cracked from the hash because
 * the input space is 2^256.
 */
export function generateOpaqueToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Constant-time compare two hex strings. Returns false on length mismatch. */
export function secureEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/** 6-digit numeric MFA code. Always zero-padded. */
export function generateNumericCode(digits = 6): string {
  if (digits < 1 || digits > 10) {
    throw new Error('digits must be 1..10');
  }
  const maxExclusive = 10 ** digits;
  // Reject sampling avoids modulo bias from `% maxExclusive` on
  // 32-bit reads. We pull a 32-bit unsigned integer and accept it only
  // if it's within the largest multiple of maxExclusive that fits in
  // 32 bits. At 6 digits this loops ~0% of the time.
  const cutoff = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
  for (;;) {
    const bytes = randomBytes(4);
    const value = bytes.readUInt32BE(0);
    if (value < cutoff) {
      return (value % maxExclusive).toString().padStart(digits, '0');
    }
  }
}
