import { Injectable } from '@nestjs/common';
import type { UserRole } from '@prisma/client';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { labelFromUserAgent } from './device';
import { generateOpaqueToken, hashToken } from './tokens';

export const SESSION_COOKIE_NAME = 'klinika_session';
const SHORT_SESSION_HOURS = 8;
const LONG_SESSION_DAYS = 30;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const TOUCH_DEBOUNCE_MS = 60_000;

export interface ValidatedSession {
  sessionId: string;
  userId: string;
  clinicId: string;
  role: UserRole;
}

export interface SessionSummary {
  id: string;
  deviceLabel: string;
  ipAddress: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
  extendedTtl: boolean;
}

/**
 * Server-side session storage. Cookies hold a 256-bit opaque token;
 * `auth_sessions` stores its SHA-256, expiry, and metadata. The
 * AuthGuard calls `validate()` on every authenticated request.
 *
 * `extendedTtl` corresponds to the "Më mbaj të kyçur" checkbox on
 * the login form: when true, the cookie + DB row last 30 days; when
 * false, 8 hours.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(SessionService.name)
    private readonly logger: PinoLogger,
  ) {}

  async issue(
    userId: string,
    clinicId: string,
    extendedTtl: boolean,
    ctx: Pick<RequestContext, 'ipAddress' | 'userAgent'>,
  ): Promise<{ rawToken: string; expiresAt: Date; sessionId: string }> {
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = extendedTtl
      ? new Date(Date.now() + LONG_SESSION_DAYS * MS_PER_DAY)
      : new Date(Date.now() + SHORT_SESSION_HOURS * MS_PER_HOUR);
    const session = await this.prisma.authSession.create({
      data: {
        userId,
        clinicId,
        tokenHash,
        expiresAt,
        extendedTtl,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent ?? '',
        deviceLabel: labelFromUserAgent(ctx.userAgent),
      },
    });
    this.logger.info({ userId, sessionId: session.id, extendedTtl }, 'Session issued');
    return { rawToken, expiresAt, sessionId: session.id };
  }

  async validate(
    rawToken: string,
    ctx: Pick<RequestContext, 'ipAddress'>,
  ): Promise<ValidatedSession | null> {
    const tokenHash = hashToken(rawToken);
    const row = await this.prisma.authSession.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, role: true, clinicId: true, isActive: true } } },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    if (!row.user.isActive) return null;

    // Debounce `last_used_at` writes to avoid a write per request. A
    // minute's resolution is plenty for the active-sessions list and
    // keeps p50 read paths from spawning a write.
    const sinceLastTouch = Date.now() - row.lastUsedAt.getTime();
    if (sinceLastTouch > TOUCH_DEBOUNCE_MS) {
      await this.prisma.authSession
        .update({
          where: { id: row.id },
          data: { lastUsedAt: new Date(), ipAddress: ctx.ipAddress },
        })
        .catch(() => {
          // Update conflicts are non-fatal: another concurrent request
          // already refreshed the row. Validation succeeds either way.
        });
    }

    return {
      sessionId: row.id,
      userId: row.userId,
      clinicId: row.clinicId,
      role: row.user.role,
    };
  }

  async revokeByToken(rawToken: string, reason: string): Promise<boolean> {
    const tokenHash = hashToken(rawToken);
    const result = await this.prisma.authSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count > 0;
  }

  async revokeById(sessionId: string, reason: string): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return result.count > 0;
  }

  /** Revoke every active session for a user except `keepSessionId`. */
  async revokeAllExcept(userId: string, keepSessionId: string, reason: string): Promise<number> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        NOT: { id: keepSessionId },
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    if (result.count > 0) {
      this.logger.info({ userId, count: result.count, reason }, 'Other sessions revoked');
    }
    return result.count;
  }

  async list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const rows = await this.prisma.authSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.deviceLabel,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      isCurrent: r.id === currentSessionId,
      extendedTtl: r.extendedTtl,
    }));
  }
}
