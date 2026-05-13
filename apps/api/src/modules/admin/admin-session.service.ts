import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import { labelFromUserAgent } from '../auth/device';
import { generateOpaqueToken, hashToken } from '../auth/tokens';

export const ADMIN_SESSION_COOKIE_NAME = 'klinika_admin_session';
const SESSION_HOURS = 8;
const MS_PER_HOUR = 60 * 60 * 1000;
const TOUCH_DEBOUNCE_MS = 60_000;

export interface ValidatedAdminSession {
  sessionId: string;
  platformAdminId: string;
}

/**
 * Server-side session storage for platform admins. Cookies hold a
 * 256-bit opaque token; `auth_admin_sessions` stores its SHA-256.
 *
 * Admin sessions are always short-lived (8 hours) — no "remember me"
 * checkbox. Platform admins re-authenticate (with MFA) at least once
 * per working day. That's stricter than tenant users on purpose:
 * platform admin compromise is platform-wide.
 */
@Injectable()
export class AdminSessionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AdminSessionService.name)
    private readonly logger: PinoLogger,
  ) {}

  async issue(
    platformAdminId: string,
    ctx: { ipAddress: string; userAgent: string },
  ): Promise<{ rawToken: string; expiresAt: Date; sessionId: string }> {
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_HOURS * MS_PER_HOUR);
    const session = await this.prisma.authAdminSession.create({
      data: {
        platformAdminId,
        tokenHash,
        expiresAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent ?? '',
        deviceLabel: labelFromUserAgent(ctx.userAgent),
      },
    });
    this.logger.info({ platformAdminId, sessionId: session.id }, 'Admin session issued');
    return { rawToken, expiresAt, sessionId: session.id };
  }

  async validate(
    rawToken: string,
    ctx: { ipAddress: string },
  ): Promise<ValidatedAdminSession | null> {
    const tokenHash = hashToken(rawToken);
    const row = await this.prisma.authAdminSession.findUnique({
      where: { tokenHash },
      include: { platformAdmin: { select: { id: true, isActive: true } } },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    if (!row.platformAdmin.isActive) return null;

    const sinceLastTouch = Date.now() - row.lastUsedAt.getTime();
    if (sinceLastTouch > TOUCH_DEBOUNCE_MS) {
      await this.prisma.authAdminSession
        .update({
          where: { id: row.id },
          data: { lastUsedAt: new Date(), ipAddress: ctx.ipAddress },
        })
        .catch(() => {
          // Concurrent refresh — non-fatal.
        });
    }

    return { sessionId: row.id, platformAdminId: row.platformAdminId };
  }

  async revokeByToken(rawToken: string, reason: string): Promise<boolean> {
    const tokenHash = hashToken(rawToken);
    const result = await this.prisma.authAdminSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count > 0;
  }
}
