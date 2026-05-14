import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM at-rest encryption for sensitive blobs (signatures,
 * SMTP passwords). The key is provided via the `STORAGE_ENCRYPTION_KEY`
 * env var as 32 raw bytes encoded base64 (44 chars). In dev/test we
 * fall back to a deterministic dev key so the integration tests run
 * without ceremony — production deploys must override.
 *
 * File / payload layout:
 *
 *     [ 12 bytes IV ][ ciphertext ][ 16 bytes GCM tag ]
 *
 * GCM is authenticated; tampering with the IV, ciphertext, or tag
 * causes `decrypt()` to throw — failure is preferred over silent
 * corruption when handling clinician signatures.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const DEV_KEY_WARNING = Symbol('storage-cipher-dev-warning');
type WarningGlobal = typeof globalThis & { [DEV_KEY_WARNING]?: boolean };

export function getStorageKey(): Buffer {
  const raw = process.env['STORAGE_ENCRYPTION_KEY'];
  if (raw && raw.length > 0) {
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== KEY_LENGTH) {
      throw new Error(
        `STORAGE_ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${buf.length}). ` +
          'Generate with: openssl rand -base64 32',
      );
    }
    return buf;
  }
  // Dev / test fallback. Only safe outside production — refuse there.
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('STORAGE_ENCRYPTION_KEY is required in production.');
  }
  const g = globalThis as WarningGlobal;
  if (!g[DEV_KEY_WARNING]) {
    g[DEV_KEY_WARNING] = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[storage-cipher] STORAGE_ENCRYPTION_KEY unset — using a non-secret dev key. Set it in .env before production.',
    );
  }
  // Stable 32-byte sentinel — chosen so dev/test seeds decrypt
  // consistently across process restarts.
  return Buffer.from('klinika-development-encryption!!', 'utf8');
}

export function encryptBytes(plaintext: Buffer, key: Buffer = getStorageKey()): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]);
}

export function decryptBytes(blob: Buffer, key: Buffer = getStorageKey()): Buffer {
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('Cipher blob too short.');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export interface EncryptedString {
  cipher: string;
  iv: string;
  tag: string;
}

/**
 * Encrypts a short UTF-8 string (SMTP password). Returns base64 parts
 * suitable for stashing inside a JSONB blob without binary handling.
 */
export function encryptString(plaintext: string, key: Buffer = getStorageKey()): EncryptedString {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    cipher: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decryptString(enc: EncryptedString, key: Buffer = getStorageKey()): string {
  const iv = Buffer.from(enc.iv, 'base64');
  const tag = Buffer.from(enc.tag, 'base64');
  const ciphertext = Buffer.from(enc.cipher, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
