import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { labelFromUserAgent } from './device';
import { generateOpaqueToken, hashToken } from './tokens';

export const TRUSTED_DEVICE_COOKIE_NAME = 'klinika_trust';
export const TRUSTED_DEVICE_TTL_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TrustedDeviceRecord {
  id: string;
  userId: string;
  clinicId: string;
  label: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ipAddress: string;
  isCurrent: boolean;
}

/**
 * Maintains the user's roster of trusted browsers. A trusted device
 * skips email MFA on subsequent logins for 30 days. Per ADR-004, the
 * cookie value is a 256-bit random token; only its SHA-256 is stored.
 *
 * Cookies are user-scoped (the cookie identifies the user) but
 * carrying a trusted-device cookie alone does NOT authenticate — the
 * user still types their password every login. The cookie just lets
 * us decide whether to demand MFA.
 */
@Injectable()
export class TrustedDeviceService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(TrustedDeviceService.name)
    private readonly logger: PinoLogger,
  ) {}

  /**
   * Look up a trusted-device cookie. If the row exists, isn't revoked,
   * and isn't expired, return its userId so the caller can prove the
   * cookie matches the typed email. Returns null otherwise.
   */
  async findValid(rawToken: string): Promise<{ id: string; userId: string; clinicId: string } | null> {
    const tokenHash = hashToken(rawToken);
    const row = await this.prisma.authTrustedDevice.findUnique({
      where: { tokenHash },
    });
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt.getTime() <= Date.now()) return null;
    return { id: row.id, userId: row.userId, clinicId: row.clinicId };
  }

  /**
   * Stamp a new trusted-device row and return the raw token. Caller
   * sets the cookie. The cookie is HttpOnly+Secure+SameSite=Lax and
   * scoped to the parent domain so subsequent visits to the same
   * tenant subdomain are recognised.
   */
  async issue(
    userId: string,
    clinicId: string,
    ctx: Pick<RequestContext, 'ipAddress' | 'userAgent'>,
  ): Promise<{ rawToken: string; expiresAt: Date; label: string }> {
    const rawToken = generateOpaqueToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_DAYS * MS_PER_DAY);
    const label = labelFromUserAgent(ctx.userAgent);

    await this.prisma.authTrustedDevice.create({
      data: {
        userId,
        clinicId,
        tokenHash,
        label,
        expiresAt,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent ?? '',
      },
    });
    return { rawToken, expiresAt, label };
  }

  async touch(deviceId: string, ctx: Pick<RequestContext, 'ipAddress'>): Promise<void> {
    await this.prisma.authTrustedDevice.update({
      where: { id: deviceId },
      data: { lastSeenAt: new Date(), ipAddress: ctx.ipAddress },
    });
  }

  async list(userId: string, clinicId: string, currentDeviceId: string | null): Promise<TrustedDeviceRecord[]> {
    const rows = await this.prisma.authTrustedDevice.findMany({
      where: {
        userId,
        clinicId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastSeenAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      clinicId: r.clinicId,
      label: r.label,
      createdAt: r.createdAt,
      lastSeenAt: r.lastSeenAt,
      expiresAt: r.expiresAt,
      ipAddress: r.ipAddress,
      isCurrent: r.id === currentDeviceId,
    }));
  }

  async revoke(userId: string, deviceId: string, reason: string): Promise<boolean> {
    const result = await this.prisma.authTrustedDevice.updateMany({
      where: { id: deviceId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.info({ userId, deviceId, reason }, 'Trusted device revoked');
      return true;
    }
    return false;
  }

  async revokeAll(userId: string, reason: string): Promise<number> {
    const result = await this.prisma.authTrustedDevice.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count > 0) {
      this.logger.info({ userId, count: result.count, reason }, 'All trusted devices revoked');
    }
    return result.count;
  }
}
