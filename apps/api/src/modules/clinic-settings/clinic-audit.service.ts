import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import type { AuditQuery, AuditQueryResponse, AuditRow } from './clinic-settings.dto';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
const CSV_HARD_LIMIT = 10_000;

/**
 * Read-only access to the per-clinic audit log. Always scopes by
 * `clinicId` (RLS provides the second layer). Supports filtering by
 * date range, user, action, and resource type — the same dimensions
 * exposed in the UI's filter row.
 *
 * Pagination uses a keyset cursor (`timestamp,id`) so adding new rows
 * never shifts the page beneath the reader. CSV export uses the same
 * filter set, capped at {@link CSV_HARD_LIMIT} rows to keep the
 * response bounded; users hitting the cap should narrow the date
 * range.
 */
@Injectable()
export class ClinicAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async query(clinicId: string, q: AuditQuery): Promise<AuditQueryResponse> {
    const where = this.whereFor(clinicId, q);
    const cursor = parseCursor(q.cursor);
    if (cursor) {
      // Keyset: rows strictly older than the cursor's (timestamp, id).
      where.AND = [
        ...((Array.isArray(where.AND) ? where.AND : []) as Prisma.AuditLogWhereInput[]),
        {
          OR: [
            { timestamp: { lt: cursor.timestamp } },
            {
              AND: [
                { timestamp: cursor.timestamp },
                { id: { lt: cursor.id } },
              ],
            },
          ],
        },
      ];
    }
    const take = Math.min(q.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = rows.slice(0, take);
    const usersById = await this.lookupUsers(
      clinicId,
      Array.from(new Set(page.map((r) => r.userId))),
    );

    const out: AuditRow[] = page.map((r) => ({
      id: r.id,
      timestamp: r.timestamp.toISOString(),
      userId: r.userId,
      userEmail: usersById.get(r.userId)?.email ?? null,
      userName: usersById.get(r.userId)?.name ?? null,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      changes: changesArray(r.changes),
      ipAddress: r.ipAddress,
    }));

    let nextCursor: string | null = null;
    if (hasMore && page.length > 0) {
      const last = page[page.length - 1]!;
      nextCursor = encodeCursor({ timestamp: last.timestamp, id: last.id });
    }
    return { rows: out, nextCursor };
  }

  async exportCsv(clinicId: string, q: AuditQuery): Promise<string> {
    const where = this.whereFor(clinicId, q);
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: CSV_HARD_LIMIT,
    });
    const usersById = await this.lookupUsers(
      clinicId,
      Array.from(new Set(rows.map((r) => r.userId))),
    );
    const header = [
      'timestamp',
      'user_email',
      'user_name',
      'action',
      'resource_type',
      'resource_id',
      'ip_address',
      'changes_json',
    ];
    const lines: string[] = [header.join(',')];
    for (const r of rows) {
      const u = usersById.get(r.userId);
      lines.push(
        [
          r.timestamp.toISOString(),
          u?.email ?? '',
          u?.name ?? '',
          r.action,
          r.resourceType,
          r.resourceId,
          r.ipAddress,
          JSON.stringify(r.changes ?? null),
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\n') + '\n';
  }

  private whereFor(clinicId: string, q: AuditQuery): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = { clinicId };
    if (q.from || q.to) {
      where.timestamp = {};
      if (q.from) where.timestamp.gte = new Date(q.from);
      if (q.to) where.timestamp.lte = new Date(q.to);
    }
    if (q.userId) where.userId = q.userId;
    if (q.action) where.action = q.action;
    if (q.resourceType) where.resourceType = q.resourceType;
    return where;
  }

  private async lookupUsers(
    clinicId: string,
    userIds: string[],
  ): Promise<Map<string, { email: string; name: string }>> {
    if (userIds.length === 0) return new Map();
    // Soft-delete middleware would hide deactivated users by default;
    // the audit log needs to surface their names too. Bypass the
    // filter explicitly.
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, clinicId },
      select: { id: true, email: true, firstName: true, lastName: true, title: true },
    });
    return new Map(
      users.map((u) => [
        u.id,
        {
          email: u.email,
          name: `${u.title ? `${u.title} ` : ''}${u.firstName} ${u.lastName}`.trim(),
        },
      ]),
    );
  }
}

function changesArray(raw: Prisma.JsonValue | null): AuditRow['changes'] {
  if (raw === null) return null;
  if (!Array.isArray(raw)) return null;
  return raw as AuditRow['changes'];
}

interface CursorPayload {
  timestamp: Date;
  id: string;
}

function parseCursor(raw: string | undefined): CursorPayload | null {
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof decoded.t !== 'string' || typeof decoded.i !== 'string') return null;
    return { timestamp: new Date(decoded.t), id: decoded.i };
  } catch {
    return null;
  }
}

function encodeCursor(p: CursorPayload): string {
  return Buffer.from(JSON.stringify({ t: p.timestamp.toISOString(), i: p.id }), 'utf8').toString(
    'base64url',
  );
}

function csvCell(value: string): string {
  if (/[,"\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
