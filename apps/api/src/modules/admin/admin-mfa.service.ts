import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { generateNumericCode, generateOpaqueToken, hashToken } from '../auth/tokens';

export const ADMIN_MFA_CODE_TTL_MINUTES = 15;
export const ADMIN_MFA_CODE_DIGITS = 6;
export const ADMIN_MFA_MAX_ATTEMPTS = 3;

const MS_PER_MINUTE = 60_000;

export type AdminMfaVerifyOutcome =
  | { ok: true; platformAdminId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' | 'too_many_attempts' | 'unknown' };

export interface AdminMfaIssueResult {
  pendingSessionId: string;
  rawCode: string;
  expiresAt: Date;
}

/**
 * Email-delivered second factor for platform admins. Same shape as
 * {@link MfaService} but against `auth_admin_mfa_codes` and without the
 * `rememberDevice`/`extendedTtl` flags — admin login MFA happens every
 * time and admin sessions are always short-lived.
 */
@Injectable()
export class AdminMfaService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AdminMfaService.name)
    private readonly logger: PinoLogger,
  ) {}

  async issue(
    platformAdminId: string,
    ctx: { ipAddress: string; userAgent: string },
  ): Promise<AdminMfaIssueResult> {
    const pendingSessionId = generateOpaqueToken();
    const rawCode = generateNumericCode(ADMIN_MFA_CODE_DIGITS);
    const codeHash = hashToken(rawCode);
    const expiresAt = new Date(Date.now() + ADMIN_MFA_CODE_TTL_MINUTES * MS_PER_MINUTE);

    await this.prisma.authAdminMfaCode.create({
      data: {
        platformAdminId,
        pendingSessionId,
        codeHash,
        expiresAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent ?? '',
      },
    });

    this.logger.info({ platformAdminId, pendingSessionId }, 'Admin MFA code issued');
    return { pendingSessionId, rawCode, expiresAt };
  }

  async findPending(pendingSessionId: string): Promise<{
    platformAdminId: string;
    expiresAt: Date;
    consumedAt: Date | null;
    attempts: number;
  } | null> {
    const row = await this.prisma.authAdminMfaCode.findUnique({ where: { pendingSessionId } });
    if (!row) return null;
    return {
      platformAdminId: row.platformAdminId,
      expiresAt: row.expiresAt,
      consumedAt: row.consumedAt,
      attempts: row.attempts,
    };
  }

  async expirePending(pendingSessionId: string): Promise<void> {
    await this.prisma.authAdminMfaCode.updateMany({
      where: { pendingSessionId, consumedAt: null },
      data: {
        expiresAt: new Date(Date.now() - 1),
        consumedAt: new Date(),
      },
    });
  }

  async verify(pendingSessionId: string, code: string): Promise<AdminMfaVerifyOutcome> {
    const row = await this.prisma.authAdminMfaCode.findUnique({ where: { pendingSessionId } });
    if (!row) return { ok: false, reason: 'unknown' };
    if (row.consumedAt) return { ok: false, reason: 'consumed' };
    if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' };
    if (row.attempts >= ADMIN_MFA_MAX_ATTEMPTS) {
      return { ok: false, reason: 'too_many_attempts' };
    }

    const candidate = hashToken(code);
    if (row.codeHash !== candidate) {
      await this.prisma.authAdminMfaCode.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = ADMIN_MFA_MAX_ATTEMPTS - row.attempts - 1;
      if (remaining <= 0) {
        return { ok: false, reason: 'too_many_attempts' };
      }
      return { ok: false, reason: 'invalid' };
    }

    await this.prisma.authAdminMfaCode.update({
      where: { id: row.id },
      data: { consumedAt: new Date() },
    });

    return { ok: true, platformAdminId: row.platformAdminId };
  }
}
