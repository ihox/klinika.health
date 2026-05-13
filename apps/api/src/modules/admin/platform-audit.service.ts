import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';

export interface PlatformAuditContext {
  platformAdminId: string;
  sessionId: string | null;
  ipAddress: string;
  userAgent: string;
}

export interface PlatformAuditWriteOptions {
  ctx: PlatformAuditContext;
  action: string;
  resourceType: string;
  resourceId: string;
  targetClinicId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Writes to `platform_audit_log`. Separate from {@link AuditLogService}
 * because per-clinic audit entries require both a clinic and a clinic
 * user — platform admin actions have neither (cross-tenant by design
 * per ADR-005).
 *
 * Coalescing is intentionally NOT performed: every platform-admin
 * action is recorded individually. The volume is small (a few entries
 * per day at most), and operators need an exact trail.
 *
 * Defensive: logging failures never throw on the request path.
 */
@Injectable()
export class PlatformAuditService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(PlatformAuditService.name)
    private readonly logger: PinoLogger,
  ) {}

  async record(opts: PlatformAuditWriteOptions): Promise<void> {
    try {
      await this.prisma.platformAuditLog.create({
        data: {
          platformAdminId: opts.ctx.platformAdminId,
          action: opts.action,
          targetClinicId: opts.targetClinicId ?? null,
          resourceType: opts.resourceType,
          resourceId: opts.resourceId,
          metadata: (opts.metadata ?? null) as Prisma.InputJsonValue,
          ipAddress: opts.ctx.ipAddress,
          userAgent: opts.ctx.userAgent ?? '',
          sessionId: opts.ctx.sessionId ?? 'none',
        },
      });
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), action: opts.action },
        'Platform audit write failed',
      );
    }
  }
}
