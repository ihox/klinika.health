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
import { localDateToday, utcMidnight } from '../../common/datetime';
import type { RequestContext } from '../../common/request-context/request-context';
import { hasClinicalAccess, primaryRoleForDisplay } from '../../common/request-context/role-helpers';
import type { AppRole } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type CreateVisitInput,
  type UpdateVisitInput,
  type VisitDto,
  type VisitHistoryEntryDto,
  type VisitHistoryFieldChange,
  toVisitDto,
} from './visits.dto';
import { VisitsCalendarEventsService } from './visits-calendar.events';
import { VisitsCalendarService } from './visits-calendar.service';
import { utcToLocalParts } from './visits-calendar.tz';

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
    private readonly calendar: VisitsCalendarService,
    private readonly calendarEvents: VisitsCalendarEventsService,
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
      include: { diagnoses: { include: { code: true } } },
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
  // Create (doctor-initiated "Vizitë e re")
  // -------------------------------------------------------------------------
  //
  // The doctor opens a chart, clicks "+ Vizitë e re", picks a patient.
  // Common case: a sibling / companion who walked in alongside today's
  // booked patient. We pair the new row to the in-progress booking so
  // the receptionist's calendar surfaces it in the right lane (same
  // row as the scheduled sibling) without any UI hover required.
  //
  // Pairing resolution lives in `VisitsCalendarService.findNextUnpaired
  // ScheduledVisit`. On a day with no scheduled bookings (or with
  // every booking already paired), we fall back to the same row shape
  // `create()` produces — a calendar-invisible chart entry — so the
  // doctor is never blocked from charting just because there's no
  // schedule that day.

  async createDoctorNew(
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

    const today = localDateToday();

    // Gate (Phase 2b patch): if THIS patient already has an active
    // visit today, the doctor is charting them as a follow-up of
    // their own existing row — not as a walk-in companion of someone
    // else. Short-circuit to the regular-visit path so the new row
    // is `is_walk_in=false`, `scheduled_for=null`, `status='completed'`,
    // no pairing — identical to the legacy `POST /api/visits` shape.
    //
    // Active = the three pre-finish statuses (scheduled / arrived /
    // in_progress). Completed / no_show / cancelled today do NOT
    // count: a patient who finished this morning and walks back in
    // this afternoon is correctly a walk-in again.
    const activeVisitToday = await this.prisma.visit.findFirst({
      where: {
        clinicId,
        patientId: patient.id,
        deletedAt: null,
        visitDate: utcMidnight(today),
        status: { in: ['scheduled', 'arrived', 'in_progress'] },
      },
      select: { id: true },
    });
    if (activeVisitToday) {
      return this.create(clinicId, payload, ctx);
    }

    const pair = await this.calendar.findNextUnpairedScheduledVisit(clinicId, today);

    if (pair == null) {
      // No scheduled visit to pair with → standalone chart entry,
      // identical to the legacy `POST /api/visits` shape.
      return this.create(clinicId, payload, ctx);
    }

    // Paired walk-in. Matches receptionist-initiated walk-in semantics
    // but skips the pair-validation guard (we just resolved it) and
    // forces `status='in_progress'` — the doctor is about to start
    // charting, so the row goes straight to in-progress. The
    // arrived_at policy (snap-to-5-min + stack-on-collision) is shared
    // with the receptionist's `/api/visits/walkin` path via the same
    // helper — Phase 2b §2.
    const visitDate = payload.visitDate
      ? utcMidnight(payload.visitDate)
      : utcMidnight(today);
    const [arrivedAt, durationMinutes] = await Promise.all([
      this.calendar.computeWalkInArrivedAt(clinicId, new Date()),
      this.calendar.getClinicWalkInDuration(clinicId),
    ]);

    const created = await this.prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate,
        scheduledFor: null,
        durationMinutes,
        isWalkIn: true,
        arrivedAt,
        status: 'in_progress',
        pairedWithVisitId: pair.id,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      include: { diagnoses: { include: { code: true } } },
    });

    await this.audit.record({
      ctx,
      action: 'visit.walkin.added',
      resourceType: 'visit',
      resourceId: created.id,
      changes: [
        { field: 'patientId', old: null, new: created.patientId },
        { field: 'isWalkIn', old: null, new: true },
        { field: 'arrivedAt', old: null, new: arrivedAt.toISOString() },
        { field: 'status', old: null, new: created.status },
        { field: 'pairedWithVisitId', old: null, new: pair.id },
      ],
    });

    const emittedAt = new Date().toISOString();
    const localDate = utcToLocalParts(arrivedAt).date;
    this.calendarEvents.emit({
      type: 'visit.created',
      clinicId,
      visitId: created.id,
      localDate,
      isWalkIn: true,
      status: created.status,
      emittedAt,
    });
    // Phase 2b — sibling event carrying the patient name + actor id so
    // the doctor's home can toast a walk-in arrival without a
    // round-trip. The acting doctor's own browser self-suppresses via
    // `actorUserId === currentUser.id`.
    this.calendarEvents.emit({
      type: 'visit.walkin.added',
      clinicId,
      visitId: created.id,
      localDate,
      isWalkIn: true,
      status: created.status,
      emittedAt,
      actorUserId: ctx.userId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      pairedWithVisitId: pair.id,
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
      include: { diagnoses: { include: { code: true } } },
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
        include: { diagnoses: { include: { code: true } } },
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

      const wroteScalarField = Object.keys(data).length > 1;
      const wroteDiagnoses = payload.diagnoses !== undefined;

      // Nothing to change beyond updatedBy — drop out without touching
      // updated_at / firing a no-op audit row.
      if (!wroteScalarField && !wroteDiagnoses) {
        return toVisitDto(before);
      }

      // Always run the scalar update so updated_by/updated_at advance,
      // even when only diagnoses changed.
      const after = await tx.visit.update({
        where: { id },
        data,
        include: { diagnoses: { include: { code: true } } },
      });

      // ---------------------------------------------------------------------
      // Diagnoses sync — full rewrite of visit_diagnoses rows when the
      // payload includes the key. The doctor sees the chip list as a
      // single source of truth, so partial syncs would be surprising.
      // ---------------------------------------------------------------------
      let diagnosisDiff: { old: string | null; new: string | null } | null = null;
      let afterWithDiagnoses = after;
      if (wroteDiagnoses) {
        const nextCodes = payload.diagnoses ?? [];
        const beforeCodes = before.diagnoses
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((d) => d.icd10Code);

        const beforeKey = serialiseDiagnoses(beforeCodes);
        const nextKey = serialiseDiagnoses(nextCodes);

        if (beforeKey !== nextKey) {
          await tx.visitDiagnosis.deleteMany({ where: { visitId: id } });
          if (nextCodes.length > 0) {
            // Validate that every code exists. Bad codes hit the FK
            // anyway, but a pre-check produces a kinder Albanian error
            // message than a Prisma raw-error surface.
            const existing = await tx.icd10Code.findMany({
              where: { code: { in: nextCodes } },
              select: { code: true },
            });
            const known = new Set(existing.map((r) => r.code));
            for (const code of nextCodes) {
              if (!known.has(code)) {
                throw new NotFoundException(
                  `Kodi ICD-10 "${code}" nuk u gjet.`,
                );
              }
            }
            await tx.visitDiagnosis.createMany({
              data: nextCodes.map((code, idx) => ({
                visitId: id,
                icd10Code: code,
                orderIndex: idx,
              })),
            });
          }

          // Bump per-doctor usage counts for every code in the new
          // list — including codes that were already on the visit
          // (re-saving the form is a fresh signal that the doctor still
          // considers the code current).
          for (const code of nextCodes) {
            await tx.doctorDiagnosisUsage.upsert({
              where: {
                doctor_diagnosis_usage_doctor_code_unique: {
                  doctorId: ctx.userId!,
                  icd10Code: code,
                },
              },
              update: {
                useCount: { increment: 1 },
                lastUsedAt: new Date(),
              },
              create: {
                clinicId,
                doctorId: ctx.userId!,
                icd10Code: code,
                useCount: 1,
                lastUsedAt: new Date(),
              },
            });
          }

          diagnosisDiff = { old: beforeKey || null, new: nextKey || null };

          // Re-fetch with the join included so the response DTO has the
          // latest diagnoses (createMany doesn't return rows).
          afterWithDiagnoses = await tx.visit.findUniqueOrThrow({
            where: { id },
            include: { diagnoses: { include: { code: true } } },
          });
        }
      }

      const diffs = computeDiffs(before, after);
      if (diagnosisDiff) {
        diffs.push({
          field: 'diagnoses',
          old: diagnosisDiff.old,
          new: diagnosisDiff.new,
        });
      }
      if (diffs.length > 0) {
        await this.audit.record({
          ctx,
          action: 'visit.updated',
          resourceType: 'visit',
          resourceId: id,
          changes: diffs,
        });
      }

      return toVisitDto(afterWithDiagnoses);
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
      include: { diagnoses: { include: { code: true } } },
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
      select: { id: true, firstName: true, lastName: true, roles: true, title: true },
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
        userRole: primaryRoleForDisplay(user?.roles as AppRole[] | undefined),
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
    if (hasClinicalAccess(ctx.roles)) return;
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

/**
 * Stable string form of an ordered ICD-10 list, used as the audit-log
 * "old"/"new" value and as the change-detection key. Comma-joined
 * (the codes themselves never contain commas) so a single reorder
 * registers as a diff without inventing a JSON encoding.
 */
export function serialiseDiagnoses(codes: string[]): string {
  return codes.join(',');
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
  roles: string[];
  title: string | null;
}): string {
  // Doctors are addressed by title ("Dr. Taulant Shala") in the audit
  // trail; receptionists and clinic admins are first + last. Anyone
  // carrying the doctor role gets the doctor formatting — they wrote
  // a prescription somewhere, that's the relevant identity.
  if (user.roles.includes('doctor')) {
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
