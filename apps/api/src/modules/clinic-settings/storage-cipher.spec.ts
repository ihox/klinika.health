import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decryptBytes, decryptString, encryptBytes, encryptString } from './storage-cipher';

describe('storage-cipher', () => {
  it('round-trips byte blobs through encryptBytes/decryptBytes', () => {
    const original = randomBytes(4096);
    const blob = encryptBytes(original);
    expect(blob.length).toBeGreaterThan(original.length);
    const decoded = decryptBytes(blob);
    expect(Buffer.compare(decoded, original)).toBe(0);
  });

  it('produces different ciphertexts for the same input (random IV)', () => {
    const plaintext = Buffer.from('Klinika signature payload');
    const a = encryptBytes(plaintext);
    const b = encryptBytes(plaintext);
    expect(Buffer.compare(a, b)).not.toBe(0);
  });

  it('detects tampered ciphertext via the GCM tag', () => {
    const blob = encryptBytes(Buffer.from('important'));
    // Flip a bit somewhere in the ciphertext body (skip IV).
    const bad = Buffer.from(blob);
    bad[20] ^= 0xff;
    expect(() => decryptBytes(bad)).toThrow();
  });

  it('round-trips short strings through encryptString/decryptString', () => {
    const enc = encryptString('hunter2-smtp-pass');
    expect(enc.cipher).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(enc.iv).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(enc.tag).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(decryptString(enc)).toBe('hunter2-smtp-pass');
  });

  it('refuses to decrypt a too-short blob', () => {
    expect(() => decryptBytes(Buffer.alloc(8))).toThrow();
  });
});
