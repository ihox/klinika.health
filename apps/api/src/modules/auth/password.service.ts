import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

export type PasswordStrength = 'empty' | 'weak' | 'fair' | 'medium' | 'strong' | 'very_strong';

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

const HIBP_RANGE_ENDPOINT = 'https://api.pwnedpasswords.com/range/';
const HIBP_REQUEST_TIMEOUT_MS = 1500;
const HIBP_HEADER = { 'Add-Padding': 'true' };

export const MIN_PASSWORD_LENGTH = 10;
export const ACCEPTABLE_STRENGTHS: ReadonlySet<PasswordStrength> = new Set([
  'medium',
  'strong',
  'very_strong',
]);

@Injectable()
export class PasswordService {
  constructor(
    @InjectPinoLogger(PasswordService.name)
    private readonly logger: PinoLogger,
  ) {}

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, ARGON2_OPTIONS);
  }

  /** Argon2 verify with no information leak about hash structure. */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch (err: unknown) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'argon2.verify threw',
      );
      return false;
    }
  }

  /**
   * Score a password into one of six buckets using a hand-rolled
   * heuristic that matches the prototype's §3.4 5-state indicator
   * (empty + 5 strengths). We deliberately don't pull in zxcvbn:
   * Albanian/Kosovar context, predictable dictionaries, and the
   * library's bundle size doesn't pay for itself for v1.
   */
  evaluateStrength(plain: string): PasswordStrength {
    if (plain.length === 0) return 'empty';
    if (plain.length <= 6) return 'weak';
    if (plain.length <= 8) return 'fair';

    let variety = 0;
    if (/[a-z]/.test(plain)) variety += 1;
    if (/[A-Z]/.test(plain)) variety += 1;
    if (/[0-9]/.test(plain)) variety += 1;
    if (/[^a-zA-Z0-9]/.test(plain)) variety += 1;

    if (plain.length <= 11) return 'medium';
    if (plain.length <= 15) {
      return variety >= 3 ? 'strong' : 'medium';
    }
    return variety >= 3 ? 'very_strong' : 'strong';
  }

  isStrongEnough(plain: string): boolean {
    if (plain.length < MIN_PASSWORD_LENGTH) return false;
    return ACCEPTABLE_STRENGTHS.has(this.evaluateStrength(plain));
  }

  /**
   * Have I Been Pwned k-anonymity check. We send the first 5 hex chars
   * of the SHA-1 of the plaintext; HIBP returns ~500 suffix+count
   * pairs. We check the rest of the hash locally — the plaintext never
   * leaves the process.
   *
   * Soft-fail: any network or parse error returns `false` (treated as
   * not-pwned). Login flow continues so an HIBP outage doesn't lock
   * users out, but the failure is logged.
   */
  async isPwned(plain: string): Promise<boolean> {
    try {
      const sha1 = createHash('sha1').update(plain).digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HIBP_REQUEST_TIMEOUT_MS);
      try {
        const resp = await fetch(`${HIBP_RANGE_ENDPOINT}${prefix}`, {
          headers: HIBP_HEADER,
          signal: controller.signal,
        });
        if (!resp.ok) {
          this.logger.warn({ status: resp.status }, 'HIBP responded with non-OK status');
          return false;
        }
        const text = await resp.text();
        for (const line of text.split(/\r?\n/)) {
          const [suf, countStr] = line.split(':');
          if (!suf || !countStr) continue;
          if (suf.trim().toUpperCase() === suffix) {
            const count = Number(countStr.trim());
            return Number.isFinite(count) && count > 0;
          }
        }
        return false;
      } finally {
        clearTimeout(timeout);
      }
    } catch (err: unknown) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'HIBP check failed (treating as not-pwned)',
      );
      return false;
    }
  }
}
