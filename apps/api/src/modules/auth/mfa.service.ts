import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { generateNumericCode, generateOpaqueToken, hashToken } from './tokens';

export const MFA_CODE_TTL_MINUTES = 15;
export const MFA_CODE_DIGITS = 6;
export const MFA_MAX_ATTEMPTS = 3;

const MS_PER_MINUTE = 60_000;

export type MfaVerifyOutcome =
  | { ok: true; userId: string; clinicId: string; rememberDevice: boolean; extendedTtl: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' | 'too_many_attempts' | 'unknown' };

export interface MfaIssueResult {
  /** Returned to the browser; the verify page submits this back with the code. */
  pendingSessionId: string;
  /** Raw 6-digit code emailed to the user. Never persisted. */
  rawCode: string;
  expiresAt: Date;
}

/**
 * Email-delivered second factor. Codes are 6 digits, hashed at rest,
 * 15-minute TTL, max 3 verification attempts. Code generation uses
 * `generateNumericCode` (modulo-bias-free) so an attacker can't
 * narrow the search space from observing the code distribution.
 *
 * The pendingSessionId is what the browser carries between
 * `/auth/login` (which returns it) and `/auth/mfa/verify` (which
 * consumes it). It's a 256-bit random token, not the user id, so a
 * leaked client-side request can't be replayed against another user.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(MfaService.name)
    private readonly logger: PinoLogger,
  ) {}

  async issue(
    userId: string,
    clinicId: string,
    options: { rememberDevice: boolean; extendedTtl: boolean },
    ctx: Pick<RequestContext, 'ipAddress' | 'userAgent'>,
  ): Promise<MfaIssueResult> {
    const pendingSessionId = generateOpaqueToken();
    const rawCode = generateNumericCode(MFA_CODE_DIGITS);
    const codeHash = hashToken(rawCode);
    const expiresAt = new Date(Date.now() + MFA_CODE_TTL_MINUTES * MS_PER_MINUTE);

    await this.prisma.authMfaCode.create({
      data: {
        userId,
        clinicId,
        pendingSessionId,
        codeHash,
        expiresAt,
        rememberDevice: options.rememberDevice,
        extendedTtl: options.extendedTtl,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent ?? '',
      },
    });

    this.logger.info({ userId, clinicId, pendingSessionId }, 'MFA code issued');
    return { pendingSessionId, rawCode, expiresAt };
  }

  /**
   * Find the active pending session — used by the verify page to load
   * the masked email and by `resend` to mark the previous code
   * expired before issuing a new one.
   */
  async findPending(pendingSessionId: string): Promise<{
    userId: string;
    clinicId: string;
    rememberDevice: boolean;
    extendedTtl: boolean;
    expiresAt: Date;
    consumedAt: Date | null;
    attempts: number;
  } | null> {
    const row = await this.prisma.authMfaCode.findUnique({ where: { pendingSessionId } });
    if (!row) return null;
    return {
      userId: row.userId,
      clinicId: row.clinicId,
      rememberDevice: row.rememberDevice,
      extendedTtl: row.extendedTtl,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      attempts: row.attempts,
    };
  }

  /**
   * Mark a pending session as expired (used when the user clicks
   * "Dërgoje përsëri" — we generate a new pendingSessionId rather
   * than overwriting in place so an in-flight verify can't race).
   */
  async expirePending(pendingSessionId: string): Promise<void> {
    await this.prisma.authMfaCode.updateMany({
      where: { pendingSessionId, consumedAt: null },
      data: {
        expiresAt: new Date(Date.now() - 1),
        consumedAt: new Date(),
      },
    });
  }

  async verify(pendingSessionId: string, code: string): Promise<MfaVerifyOutcome> {
    const row = await this.prisma.authMfaCode.findUnique({ where: { pendingSessionId } });
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.consumedAt) return { ok: false, reason: 'consumed' };
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    if (row.attempts >= MFA_MAX_ATTEMPTS) {
      return { ok: false, reason: 'too_many_attempts' };
    }

    const expected = row.codeHash;
    const candidate = hashToken(code);
    if (expected !== candidate) {
      await this.prisma.authMfaCode.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = MFA_MAX_ATTEMPTS - row.attempts - 1;
      if (remaining <= 0) {
        return { ok: false, reason: 'too_many_attempts' };
      }
      return { ok: false, reason: 'invalid' };
    }

    await this.prisma.authMfaCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    return {
      ok: true,
      userId: row.userId,
      clinicId: row.clinicId,
      rememberDevice: row.rememberDevice,
      extendedTtl: row.extendedTtl,
    };
  }
}
