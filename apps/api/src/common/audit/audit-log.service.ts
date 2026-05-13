import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';
import type { RequestContext } from '../request-context/request-context';

const COALESCE_WINDOW_MS = 60_000;

export interface AuditFieldDiff {
  field: string;
  old: unknown;
  new: unknown;
}

export interface AuditWriteOptions {
  ctx: Pick<RequestContext, 'clinicId' | 'userId' | 'sessionId' | 'ipAddress' | 'userAgent'>;
  action: string;
  resourceType: string;
  resourceId: string;
  changes?: AuditFieldDiff[] | null;
}

/**
 * Writes the `audit_log` row for every mutation and every sensitive
 * read. Consecutive saves of the same `(userId, resourceType,
 * resourceId, action)` within `COALESCE_WINDOW_MS` collapse into the
 * most-recent row's `changes` array (per CLAUDE.md §5.3).
 *
 * Auth events typically pass `changes: null` — the `action` string
 * (`auth.login.success`, `auth.mfa.verified`) is the audit signal.
 *
 * Defensive: this never throws on the request path. A logging
 * failure is surfaced via Pino and the request still completes.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(AuditLogService.name)
    private readonly logger: PinoLogger,
  ) {}

  async record(opts: AuditWriteOptions): Promise<void> {
    const clinicId = opts.ctx.clinicId;
    const userId = opts.ctx.userId;
    if (!clinicId || !userId) {
      this.logger.warn(
        { action: opts.action, resourceId: opts.resourceId },
        'Audit write skipped: missing clinic or user',
      );
      return;
    }
    try {
      const recent = await this.prisma.auditLog.findFirst({
        where: {
          clinicId,
          userId,
          action: opts.action,
          resourceType: opts.resourceType,
          resourceId: opts.resourceId,
          timestamp: { gt: new Date(Date.now() - COALESCE_WINDOW_MS) },
        },
        orderBy: { timestamp: 'desc' },
      });

      if (recent && opts.changes && opts.changes.length > 0) {
        const merged = mergeDiffs(
          (Array.isArray(recent.changes) ? (recent.changes as unknown as AuditFieldDiff[]) : []),
          opts.changes,
        );
        await this.prisma.auditLog.update({
          where: { id: recent.id },
          data: {
            // JsonValue is structurally compatible with AuditFieldDiff[],
            // but the Prisma typing is loose; cast via unknown.
            changes: merged as unknown as object,
            timestamp: new Date(),
          },
        });
        return;
      }

      await this.prisma.auditLog.create({
        data: {
          clinicId,
          userId,
          action: opts.action,
          resourceType: opts.resourceType,
          resourceId: opts.resourceId,
          changes: opts.changes ? (opts.changes as unknown as object) : undefined,
          ipAddress: opts.ctx.ipAddress,
          userAgent: opts.ctx.userAgent ?? '',
          sessionId: opts.ctx.sessionId ?? 'none',
        },
      });
    } catch (err: unknown) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err), action: opts.action },
        'Audit write failed',
      );
    }
  }
}

function mergeDiffs(existing: AuditFieldDiff[], incoming: AuditFieldDiff[]): AuditFieldDiff[] {
  const byField = new Map<string, AuditFieldDiff>();
  for (const d of existing) byField.set(d.field, d);
  for (const d of incoming) {
    // Per the field-diff coalesce rule: keep the oldest `old` and the
    // newest `new`. If we've already seen this field, only overwrite
    // `new`; the `old` value reflects the state when the user first
    // started editing in this window.
    const prev = byField.get(d.field);
    if (prev) {
      byField.set(d.field, { field: d.field, old: prev.old, new: d.new });
    } else {
      byField.set(d.field, d);
    }
  }
  return [...byField.values()];
}
