import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  AuditLogService,
  type AuditFieldDiff,
} from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type CreateVisitInput,
  type UpdateVisitInput,
  type VisitDto,
  type VisitHistoryEntryDto,
  type VisitHistoryFieldChange,
  toVisitDto,
} from './visits.dto';

const BELGRADE_TZ = 'Europe/Belgrade';

/**
 * Subset of {@link Prisma.VisitGetPayload} keys that the auto-save
 * tracks. Every PATCH-able column appears here exactly once so the
 * diff computation is exhaustive without manual enumeration.
 */
const TRACKED_FIELDS = [
  'visitDate',
  'complaint',
  'feedingNotes',
  'feedingBreast',
  'feedingFormula',
  'feedingSolid',
  'weightG',
  'heightCm',
  'headCircumferenceCm',
  'temperatureC',
  'paymentCode',
  'examinations',
  'ultrasoundNotes',
  'legacyDiagnosis',
  'prescription',
  'labResults',
  'followupNotes',
  'otherNotes',
] as const;

@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async create(
    clinicId: string,
    payload: CreateVisitInput,
    ctx: RequestContext,
  ): Promise<VisitDto> {
    this.requireDoctorOrAdmin(ctx);
    if (!ctx.userId) {
      throw new ForbiddenException('Sesioni i pavlefshëm.');
    }

    const patient = await this.prisma.patient.findFirst({
      where: { id: payload.patientId, clinicId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Pacienti nuk u gjet.');

    const visitDate = payload.visitDate
      ? new Date(`${payload.visitDate}T00:00:00Z`)
      : todayBelgrade();

    const created = await this.prisma.visit.create({
      data: {
        clinicId,
        patientId: payload.patientId,
        visitDate,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
    });

    await this.audit.record({
      ctx,
      action: 'visit.created',
      resourceType: 'visit',
      resourceId: created.id,
      changes: [
        { field: 'patientId', old: null, new: created.patientId },
        {
          field: 'visitDate',
          old: null,
          new: created.visitDate.toISOString().slice(0, 10),
        },
      ],
    });

    return toVisitDto(created);
  }

  // -------------------------------------------------------------------------
  // Get one
  // -------------------------------------------------------------------------

  async getById(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<VisitDto> {
    this.requireDoctorOrAdmin(ctx);
    const row = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Vizita nuk u gjet.');
    return toVisitDto(row);
  }

  // -------------------------------------------------------------------------
  // Update — auto-save target
  // -------------------------------------------------------------------------
  //
  // PATCH /api/visits/:id with only the fields the user has touched.
  // Server computes the diff against the pre-save row, applies the
  // update, writes one audit row, and returns the post-save DTO.
  //
  // The audit row coalesces with prior visit.updated rows by the same
  // user within 60s (see AuditLogService). This keeps the visit's
  // change-history clean even when the form auto-saves every 1.5s.

  async update(
    clinicId: string,
    id: string,
    payload: UpdateVisitInput,
    ctx: RequestContext,
  ): Promise<VisitDto> {
    this.requireDoctorOrAdmin(ctx);
    if (!ctx.userId) {
      throw new ForbiddenException('Sesioni i pavlefshëm.');
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.visit.findFirst({
        where: { id, clinicId, deletedAt: null },
      });
      if (!before) throw new NotFoundException('Vizita nuk u gjet.');

      const data: Prisma.VisitUpdateInput = {
        updatedByUser: { connect: { id: ctx.userId! } },
      };

      if (payload.visitDate !== undefined) {
        data.visitDate = new Date(`${payload.visitDate}T00:00:00Z`);
      }
      if (payload.complaint !== undefined) data.complaint = payload.complaint;
      if (payload.feedingNotes !== undefined) data.feedingNotes = payload.feedingNotes;
      if (payload.feedingBreast !== undefined) data.feedingBreast = payload.feedingBreast;
      if (payload.feedingFormula !== undefined) data.feedingFormula = payload.feedingFormula;
      if (payload.feedingSolid !== undefined) data.feedingSolid = payload.feedingSolid;
      if (payload.weightG !== undefined) data.weightG = payload.weightG;
      if (payload.heightCm !== undefined) {
        data.heightCm = payload.heightCm == null ? null : new Prisma.Decimal(payload.heightCm);
      }
      if (payload.headCircumferenceCm !== undefined) {
        data.headCircumferenceCm =
          payload.headCircumferenceCm == null
            ? null
            : new Prisma.Decimal(payload.headCircumferenceCm);
      }
      if (payload.temperatureC !== undefined) {
        data.temperatureC =
          payload.temperatureC == null ? null : new Prisma.Decimal(payload.temperatureC);
      }
      if (payload.paymentCode !== undefined) data.paymentCode = payload.paymentCode;
      if (payload.examinations !== undefined) data.examinations = payload.examinations;
      if (payload.ultrasoundNotes !== undefined) data.ultrasoundNotes = payload.ultrasoundNotes;
      if (payload.legacyDiagnosis !== undefined) data.legacyDiagnosis = payload.legacyDiagnosis;
      if (payload.prescription !== undefined) data.prescription = payload.prescription;
      if (payload.labResults !== undefined) data.labResults = payload.labResults;
      if (payload.followupNotes !== undefined) data.followupNotes = payload.followupNotes;
      if (payload.otherNotes !== undefined) data.otherNotes = payload.otherNotes;

      // Nothing to change beyond updatedBy — drop out without touching
      // updated_at / firing a no-op audit row.
      const wroteAnyField = Object.keys(data).length > 1;
      if (!wroteAnyField) {
        return toVisitDto(before);
      }

      const after = await tx.visit.update({ where: { id }, data });

      const diffs = computeDiffs(before, after);
      if (diffs.length > 0) {
        await this.audit.record({
          ctx,
          action: 'visit.updated',
          resourceType: 'visit',
          resourceId: id,
          changes: diffs,
        });
      }

      return toVisitDto(after);
    });
  }

  // -------------------------------------------------------------------------
  // Soft delete + restore
  // -------------------------------------------------------------------------

  async softDelete(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<{ status: 'ok'; restorableUntil: string }> {
    this.requireDoctorOrAdmin(ctx);
    const before = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Vizita nuk u gjet.');

    const now = new Date();
    await this.prisma.visit.update({
      where: { id },
      data: { deletedAt: now },
    });

    await this.audit.record({
      ctx,
      action: 'visit.deleted',
      resourceType: 'visit',
      resourceId: id,
      changes: [{ field: 'deletedAt', old: null, new: now.toISOString() }],
    });

    return {
      status: 'ok',
      restorableUntil: new Date(now.getTime() + 30_000).toISOString(),
    };
  }

  async restore(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<VisitDto> {
    this.requireDoctorOrAdmin(ctx);
    const row = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: { not: null } },
    });
    if (!row) throw new NotFoundException('Vizita nuk u gjet ose nuk është e fshirë.');

    const restored = await this.prisma.visit.update({
      where: { id },
      data: { deletedAt: null },
    });

    await this.audit.record({
      ctx,
      action: 'visit.restored',
      resourceType: 'visit',
      resourceId: id,
      changes: [{ field: 'deletedAt', old: row.deletedAt?.toISOString() ?? null, new: null }],
    });

    return toVisitDto(restored);
  }

  // -------------------------------------------------------------------------
  // Change history (audit log → human-friendly DTO)
  // -------------------------------------------------------------------------
  //
  // Returns every audit row referencing the visit, newest first. The
  // frontend renders the change-history modal from this — no shaping
  // happens at the client beyond formatting timestamps.

  async getHistory(
    clinicId: string,
    id: string,
    ctx: RequestContext,
    limit: number,
  ): Promise<{ entries: VisitHistoryEntryDto[] }> {
    this.requireDoctorOrAdmin(ctx);
    // Confirm the visit exists in this clinic before exposing the
    // audit trail. Soft-deleted visits are still inspectable from
    // history — the chart never opens them, but admin tooling will
    // eventually need this.
    const visit = await this.prisma.visit.findFirst({
      where: { id, clinicId },
    });
    if (!visit) throw new NotFoundException('Vizita nuk u gjet.');

    const rows = await this.prisma.auditLog.findMany({
      where: {
        clinicId,
        resourceType: 'visit',
        resourceId: id,
        action: { in: ['visit.created', 'visit.updated', 'visit.deleted', 'visit.restored'] },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    if (rows.length === 0) {
      return { entries: [] };
    }

    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = await this.prisma.user.findMany({
      where: { clinicId, id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true, role: true, title: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const entries: VisitHistoryEntryDto[] = rows.map((r) => {
      const user = byId.get(r.userId);
      return {
        id: r.id,
        action: r.action as VisitHistoryEntryDto['action'],
        timestamp: r.timestamp.toISOString(),
        userId: r.userId,
        userDisplayName: user
          ? formatUserDisplayName(user)
          : 'Përdorues i panjohur',
        userRole:
          (user?.role as VisitHistoryEntryDto['userRole'] | undefined) ?? 'doctor',
        ipAddress: r.ipAddress ?? null,
        changes: parseChanges(r.changes),
      };
    });

    // Sensitive read: open of the change-history modal. Coalesces
    // with prior reads in the audit log within the 60s window.
    await this.audit.record({
      ctx,
      action: 'visit.history.viewed',
      resourceType: 'visit',
      resourceId: id,
      changes: null,
    });

    return { entries };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private requireDoctorOrAdmin(ctx: RequestContext): void {
    if (ctx.role === 'doctor' || ctx.role === 'clinic_admin') return;
    throw new ForbiddenException('Vetëm mjeku ka qasje në këtë veprim.');
  }
}

// ===========================================================================
// Pure helpers (exported for unit tests)
// ===========================================================================

/**
 * Diff two visit rows. Returns the field-by-field changes the audit
 * log will store. `null` / `undefined` are treated equivalently to
 * avoid spurious diffs when the column is empty on both sides.
 *
 * `updatedBy` and timestamps are intentionally not in TRACKED_FIELDS —
 * the audit row records who and when in its own columns, and the diff
 * would only ever say "yes, the row was touched" without adding
 * signal.
 */
export function computeDiffs(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditFieldDiff[] {
  const diffs: AuditFieldDiff[] = [];
  for (const field of TRACKED_FIELDS) {
    const oldVal = normaliseForDiff(before[field]);
    const newVal = normaliseForDiff(after[field]);
    if (oldVal !== newVal) {
      diffs.push({ field, old: oldVal, new: newVal });
    }
  }
  return diffs;
}

function normaliseForDiff(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string') {
    return value.length === 0 ? null : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'object' && 'toString' in value) {
    // Prisma Decimal — stringify for stable comparison
    return (value as { toString(): string }).toString();
  }
  return JSON.stringify(value);
}

function todayBelgrade(): Date {
  // Belgrade is UTC+1 (winter) / UTC+2 (summer). For storing a
  // calendar date we can use a single ISO yyyy-mm-dd derived from
  // `toLocaleDateString('sv-SE', …)` which is a robust day-anchored
  // formatter regardless of host TZ.
  const iso = new Date().toLocaleDateString('sv-SE', { timeZone: BELGRADE_TZ });
  return new Date(`${iso}T00:00:00Z`);
}

function formatUserDisplayName(user: {
  firstName: string;
  lastName: string;
  role: string;
  title: string | null;
}): string {
  // Doctors are addressed by title ("Dr. Taulant Shala") in the audit
  // trail; receptionists and clinic admins are first + last.
  if (user.role === 'doctor') {
    const title = user.title?.trim() || 'Dr.';
    return `${title} ${user.firstName} ${user.lastName}`;
  }
  return `${user.firstName} ${user.lastName}`;
}

function parseChanges(value: unknown): VisitHistoryFieldChange[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) return null;
  const out: VisitHistoryFieldChange[] = [];
  for (const entry of value as Array<Record<string, unknown>>) {
    if (entry == null || typeof entry !== 'object') continue;
    const field = entry['field'];
    if (typeof field !== 'string') continue;
    out.push({
      field,
      old: normaliseChangeValue(entry['old']),
      new: normaliseChangeValue(entry['new']),
    });
  }
  return out;
}

function normaliseChangeValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}
