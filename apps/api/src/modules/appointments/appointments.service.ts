import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AuditLogService, type AuditFieldDiff } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { parseHoursOrDefault } from '../clinic-settings/clinic-settings.service';
import {
  APPOINTMENT_STATUSES,
  type AppointmentAvailabilityResponse,
  type AppointmentDto,
  type AppointmentListResponse,
  type AppointmentStatsResponse,
  type AppointmentStatus,
  type CreateAppointmentInput,
  type SoftDeleteResponse,
  type UpdateAppointmentInput,
} from './appointments.dto';
import { computeAvailability, type OccupiedInterval } from './appointments.availability';
import { AppointmentsEventsService } from './appointments.events';
import { fitsInsideHours, toMinutes } from './appointments.hours';
import { localClockToUtc, utcToLocalParts } from './appointments.tz';

interface RangeIso {
  from: string;
  to: string;
}

// After the visits-merge (ADR-011) appointments live as rows in the
// `visits` table with `scheduled_for IS NOT NULL`. Every query in this
// service narrows by that predicate so the API can never read or write
// a doctor-only clinical visit (one created via "[Vizitë e re]" with no
// prior booking).
const APPT_BASE_WHERE = { scheduledFor: { not: null } } as const;

/**
 * Narrow the unified `visits.status` TEXT column to the AppointmentDto
 * status enum on read. The DB CHECK constraint allows six values
 * (`scheduled | arrived | in_progress | completed | no_show | cancelled`);
 * the four appointment-facing values are a subset and the only ones
 * Phase-1 writes. `arrived` and `in_progress` are Phase-2 lifecycle
 * states that the appointment endpoint never returns directly — when
 * encountered they collapse to `scheduled` so the receptionist's
 * calendar keeps rendering them as upcoming work rather than an
 * unknown state.
 */
function narrowStatusForAppointment(value: string): AppointmentStatus {
  if ((APPOINTMENT_STATUSES as readonly string[]).includes(value)) {
    return value as AppointmentStatus;
  }
  return 'scheduled';
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly events: AppointmentsEventsService,
  ) {}

  // -------------------------------------------------------------------------
  // List a date range
  // -------------------------------------------------------------------------

  async listRange(clinicId: string, range: RangeIso): Promise<AppointmentListResponse> {
    // The range covers full local days in Europe/Belgrade. We pad both
    // sides by 24h on the UTC query so a clinic running at 23:30 local
    // never falls outside the window because of DST drift, and filter
    // back to the requested local days when serializing.
    const fromUtc = new Date(localClockToUtc(range.from, '00:00').getTime() - 86_400_000);
    const toUtc = new Date(localClockToUtc(range.to, '23:59').getTime() + 86_400_000);

    const rows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        ...APPT_BASE_WHERE,
        scheduledFor: { gte: fromUtc, lte: toUtc },
      },
      orderBy: { scheduledFor: 'asc' },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, rows.map((r) => r.patientId));
    const filtered = rows.filter((r) => {
      // `scheduledFor` is non-null on every row thanks to APPT_BASE_WHERE,
      // but the Prisma client types it as `Date | null` for the optional
      // column — narrow once at the boundary.
      if (r.scheduledFor == null) return false;
      const { date } = utcToLocalParts(r.scheduledFor);
      return date >= range.from && date <= range.to;
    });
    return {
      appointments: filtered.map((r) => this.toDto(r, lastVisitMap)),
      serverTime: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Stats for one local day
  // -------------------------------------------------------------------------

  async statsForDay(clinicId: string, dateIso: string): Promise<AppointmentStatsResponse> {
    const dayStartUtc = new Date(localClockToUtc(dateIso, '00:00').getTime() - 86_400_000);
    const dayEndUtc = new Date(localClockToUtc(dateIso, '23:59').getTime() + 86_400_000);

    const rows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        ...APPT_BASE_WHERE,
        scheduledFor: { gte: dayStartUtc, lte: dayEndUtc },
      },
      orderBy: { scheduledFor: 'asc' },
      include: {
        patient: { select: { firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    // `scheduledFor` and `durationMinutes` are non-null on every row thanks
    // to APPT_BASE_WHERE; the type stays `T | null` because the column is
    // optional. We narrow once and then use `!` below.
    const onDay = rows.filter(
      (r) => r.scheduledFor != null && utcToLocalParts(r.scheduledFor).date === dateIso,
    );

    const counts = { scheduled: 0, completed: 0, no_show: 0, cancelled: 0 };
    let firstStart: Date | null = null;
    let lastEnd: Date | null = null;
    for (const r of onDay) {
      const start = r.scheduledFor!;
      const duration = r.durationMinutes ?? 0;
      const narrowed = narrowStatusForAppointment(r.status);
      counts[narrowed] += 1;
      if (!firstStart || start < firstStart) firstStart = start;
      const endAt = new Date(start.getTime() + duration * 60_000);
      if (!lastEnd || endAt > lastEnd) lastEnd = endAt;
    }

    const now = new Date();
    const upcoming = onDay
      .filter(
        (r) =>
          narrowStatusForAppointment(r.status) === 'scheduled' &&
          r.scheduledFor! >= now,
      )
      .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime());
    const next = upcoming[0] ?? null;

    return {
      date: dateIso,
      total: onDay.length,
      scheduled: counts.scheduled,
      completed: counts.completed,
      noShow: counts.no_show,
      cancelled: counts.cancelled,
      firstStart: firstStart ? firstStart.toISOString() : null,
      lastEnd: lastEnd ? lastEnd.toISOString() : null,
      nextAppointment: next
        ? {
            id: next.id,
            scheduledFor: next.scheduledFor!.toISOString(),
            durationMinutes: next.durationMinutes ?? 0,
            patient: {
              firstName: next.patient.firstName,
              lastName: next.patient.lastName,
              dateOfBirth: this.serializeDob(next.patient.dateOfBirth),
            },
          }
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Unmarked-yesterday prompt
  // -------------------------------------------------------------------------

  /**
   * Returns the appointments still in `scheduled` status from the most
   * recent past open day (and any other past open days within the last
   * 7 days that the receptionist hasn't addressed yet). The calendar
   * surfaces this as the morning prompt described in CLAUDE.md slice-08
   * §6.
   */
  async listUnmarkedPast(clinicId: string): Promise<AppointmentDto[]> {
    const lookbackUtcStart = new Date(Date.now() - 7 * 86_400_000);
    const today = utcToLocalParts(new Date()).date;
    const todayStartUtc = localClockToUtc(today, '00:00');

    const rows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        ...APPT_BASE_WHERE,
        status: 'scheduled',
        scheduledFor: { gte: lookbackUtcStart, lt: todayStartUtc },
      },
      orderBy: { scheduledFor: 'asc' },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    const lastVisitMap = await this.fetchLastVisitMap(
      clinicId,
      rows.map((r) => r.patientId),
    );
    return rows.map((r) => this.toDto(r, lastVisitMap));
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async create(
    clinicId: string,
    payload: CreateAppointmentInput,
    ctx: RequestContext,
  ): Promise<AppointmentDto> {
    if (!ctx.userId) throw new ForbiddenException('Pa përdorues.');

    const patient = await this.prisma.patient.findFirst({
      where: { id: payload.patientId, clinicId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
    });
    if (!patient) throw new NotFoundException('Pacienti nuk u gjet.');

    const hours = await this.clinicHours(clinicId);
    const startMin = toMinutes(payload.time);
    const fit = fitsInsideHours(hours, payload.date, startMin, payload.durationMinutes);
    if (!fit.fits) {
      throw new BadRequestException({
        message: this.hoursMessageFor(fit.reason),
        reason: fit.reason,
      });
    }

    const scheduledFor = localClockToUtc(payload.date, payload.time);
    const conflict = await this.findConflict(clinicId, scheduledFor, payload.durationMinutes, null);
    if (conflict) {
      throw new BadRequestException({
        message: 'Ky orar mbivendoset me një termin tjetër.',
        reason: 'conflict',
      });
    }

    // Post-merge: an appointment is a visit row with `scheduled_for` set.
    // The clinical fields stay null until the doctor opens the chart and
    // begins recording (still a separate row in Phase 1 — Phase 2 will
    // unify the doctor's "[Vizitë e re]" into this same row).
    //
    // `visit_date` is NOT NULL on visits, so we anchor it to the local
    // booking date (Europe/Belgrade). `updated_by` is required too —
    // we set it to the creator on the first insert.
    const created = await this.prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: new Date(`${payload.date}T00:00:00Z`),
        scheduledFor,
        durationMinutes: payload.durationMinutes,
        isWalkIn: false,
        status: 'scheduled',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });

    await this.audit.record({
      ctx,
      action: 'appointment.created',
      resourceType: 'appointment',
      resourceId: created.id,
      changes: [
        { field: 'patientId', old: null, new: payload.patientId },
        { field: 'scheduledFor', old: null, new: created.scheduledFor!.toISOString() },
        { field: 'durationMinutes', old: null, new: created.durationMinutes },
        { field: 'status', old: null, new: created.status },
      ],
    });

    this.events.emit({
      type: 'appointment.created',
      clinicId,
      appointmentId: created.id,
      scheduledForDate: utcToLocalParts(created.scheduledFor!).date,
      emittedAt: new Date().toISOString(),
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [patient.id]);
    return this.toDto(created, lastVisitMap);
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  async update(
    clinicId: string,
    id: string,
    payload: UpdateAppointmentInput,
    ctx: RequestContext,
  ): Promise<AppointmentDto> {
    const before = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: null, ...APPT_BASE_WHERE },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    if (!before || before.scheduledFor == null) throw new NotFoundException('Termini nuk u gjet.');

    const targetDate =
      payload.date ?? utcToLocalParts(before.scheduledFor).date;
    const targetTime =
      payload.time ?? utcToLocalParts(before.scheduledFor).time;
    const targetDuration =
      payload.durationMinutes ?? before.durationMinutes ?? 0;
    const beforeStatus = narrowStatusForAppointment(before.status);

    let nextScheduledFor = before.scheduledFor;
    if (payload.date || payload.time || payload.durationMinutes) {
      const hours = await this.clinicHours(clinicId);
      const startMin = toMinutes(targetTime);
      const fit = fitsInsideHours(hours, targetDate, startMin, targetDuration);
      if (!fit.fits) {
        throw new BadRequestException({
          message: this.hoursMessageFor(fit.reason),
          reason: fit.reason,
        });
      }
      nextScheduledFor = localClockToUtc(targetDate, targetTime);
      const conflict = await this.findConflict(clinicId, nextScheduledFor, targetDuration, id);
      if (conflict) {
        throw new BadRequestException({
          message: 'Ky orar mbivendoset me një termin tjetër.',
          reason: 'conflict',
        });
      }
    }

    const data: Prisma.VisitUpdateInput = {};
    const diffs: AuditFieldDiff[] = [];
    if (nextScheduledFor.getTime() !== before.scheduledFor.getTime()) {
      data.scheduledFor = nextScheduledFor;
      // Keep `visit_date` in sync with the local booking date so the
      // doctor's day-view bucket follows the move.
      data.visitDate = new Date(`${targetDate}T00:00:00Z`);
      diffs.push({
        field: 'scheduledFor',
        old: before.scheduledFor.toISOString(),
        new: nextScheduledFor.toISOString(),
      });
    }
    if (
      payload.durationMinutes !== undefined &&
      payload.durationMinutes !== before.durationMinutes
    ) {
      data.durationMinutes = payload.durationMinutes;
      diffs.push({
        field: 'durationMinutes',
        old: before.durationMinutes,
        new: payload.durationMinutes,
      });
    }
    if (payload.status !== undefined && payload.status !== beforeStatus) {
      data.status = payload.status;
      diffs.push({ field: 'status', old: beforeStatus, new: payload.status });
    }

    if (diffs.length === 0) {
      const lastVisitMap = await this.fetchLastVisitMap(clinicId, [before.patientId]);
      return this.toDto(before, lastVisitMap);
    }

    const after = await this.prisma.visit.update({
      where: { id },
      data,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    await this.audit.record({
      ctx,
      action: 'appointment.updated',
      resourceType: 'appointment',
      resourceId: id,
      changes: diffs,
    });
    this.events.emit({
      type: 'appointment.updated',
      clinicId,
      appointmentId: id,
      scheduledForDate: utcToLocalParts(after.scheduledFor!).date,
      emittedAt: new Date().toISOString(),
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [after.patientId]);
    return this.toDto(after, lastVisitMap);
  }

  // -------------------------------------------------------------------------
  // Soft delete + restore
  // -------------------------------------------------------------------------

  async softDelete(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<SoftDeleteResponse> {
    const before = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: null, ...APPT_BASE_WHERE },
    });
    if (!before || before.scheduledFor == null) throw new NotFoundException('Termini nuk u gjet.');
    const now = new Date();
    await this.prisma.visit.update({
      where: { id },
      data: { deletedAt: now },
    });
    await this.audit.record({
      ctx,
      action: 'appointment.deleted',
      resourceType: 'appointment',
      resourceId: id,
      changes: [{ field: 'deletedAt', old: null, new: now.toISOString() }],
    });
    this.events.emit({
      type: 'appointment.deleted',
      clinicId,
      appointmentId: id,
      scheduledForDate: utcToLocalParts(before.scheduledFor).date,
      emittedAt: new Date().toISOString(),
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
  ): Promise<AppointmentDto> {
    const row = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: { not: null }, ...APPT_BASE_WHERE },
    });
    if (!row) throw new NotFoundException('Termini nuk u gjet.');
    const restored = await this.prisma.visit.update({
      where: { id },
      data: { deletedAt: null },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    await this.audit.record({
      ctx,
      action: 'appointment.restored',
      resourceType: 'appointment',
      resourceId: id,
      changes: [{ field: 'deletedAt', old: row.deletedAt?.toISOString() ?? null, new: null }],
    });
    this.events.emit({
      type: 'appointment.updated',
      clinicId,
      appointmentId: id,
      scheduledForDate: utcToLocalParts(restored.scheduledFor!).date,
      emittedAt: new Date().toISOString(),
    });
    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [restored.patientId]);
    return this.toDto(restored, lastVisitMap);
  }

  // -------------------------------------------------------------------------
  // Availability — slice-09 booking dialog
  // -------------------------------------------------------------------------
  //
  // Returns the per-duration verdict for the chosen (date, time) anchor.
  // The dialog calls this:
  //   * on open (initial render with all options),
  //   * when the receptionist changes date or time,
  //   * when entering edit mode (with `excludeId` so the appointment
  //     being moved doesn't self-conflict).
  //
  // We fetch the day's appointments once and intersect each candidate
  // duration in memory. Three states drive the UI per AvailabilityOption:
  //   - `fits`     when hours OK + no overlap and duration ≤ slot unit
  //                (or duration > unit but no overlap with later appts)
  //   - `extends`  when hours OK + no overlap AND the booking spills past
  //                the natural slot unit (smallest configured duration)
  //   - `blocked`  when out-of-hours or overlaps with an existing appt
  //
  // The split between `fits` and `extends` is purely a UI signal —
  // both are bookable, but `extends` triggers the calm "Të vazhdojmë?"
  // notice in the dialog.

  async availability(
    clinicId: string,
    date: string,
    time: string,
    excludeId: string | null,
  ): Promise<AppointmentAvailabilityResponse> {
    const hours = await this.clinicHours(clinicId);

    // One round-trip: pull every appointment on the day for conflict math.
    const dayStartUtc = new Date(localClockToUtc(date, '00:00').getTime() - 86_400_000);
    const dayEndUtc = new Date(localClockToUtc(date, '23:59').getTime() + 86_400_000);
    const dayRows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        ...APPT_BASE_WHERE,
        // `scheduled` and `completed` are the only statuses that block
        // a slot. The post-merge `arrived` and `in_progress` are also
        // active sessions — include them defensively so a Phase-2 row
        // can't be double-booked over.
        status: { in: ['scheduled', 'arrived', 'in_progress', 'completed'] },
        scheduledFor: { gte: dayStartUtc, lte: dayEndUtc },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true, scheduledFor: true, durationMinutes: true },
    });

    // Convert each row to a local-minute interval so the pure helper
    // can do the overlap math without re-binding to TIMESTAMPTZ.
    const occupied: OccupiedInterval[] = dayRows.flatMap((r) => {
      if (r.scheduledFor == null) return [];
      const local = utcToLocalParts(r.scheduledFor);
      if (local.date !== date) return [];
      const startMin = toMinutes(local.time);
      const duration = r.durationMinutes ?? 0;
      return [{ startMin, endMin: startMin + duration }];
    });

    const { slotUnitMinutes, options } = computeAvailability(hours, date, time, occupied);
    return { date, time, slotUnitMinutes, options };
  }

  // -------------------------------------------------------------------------
  // Cross-module hook: doctor save in slice 11/12 calls this so the
  // linked appointment (if any, by patient + same local day) flips to
  // `completed`. Returns true if an update happened.
  // -------------------------------------------------------------------------

  async markCompletedFromVisit(opts: {
    clinicId: string;
    patientId: string;
    visitDate: string; // ISO yyyy-mm-dd, local day
    ctx: RequestContext;
  }): Promise<boolean> {
    const { clinicId, patientId, visitDate, ctx } = opts;
    const dayStart = localClockToUtc(visitDate, '00:00');
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const candidate = await this.prisma.visit.findFirst({
      where: {
        clinicId,
        patientId,
        deletedAt: null,
        ...APPT_BASE_WHERE,
        status: 'scheduled',
        scheduledFor: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { scheduledFor: 'asc' },
    });
    if (!candidate || candidate.scheduledFor == null) return false;
    await this.prisma.visit.update({
      where: { id: candidate.id },
      data: { status: 'completed' },
    });
    await this.audit.record({
      ctx,
      action: 'appointment.completed',
      resourceType: 'appointment',
      resourceId: candidate.id,
      changes: [{ field: 'status', old: 'scheduled', new: 'completed' }],
    });
    this.events.emit({
      type: 'appointment.updated',
      clinicId,
      appointmentId: candidate.id,
      scheduledForDate: utcToLocalParts(candidate.scheduledFor!).date,
      emittedAt: new Date().toISOString(),
    });
    return true;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async clinicHours(clinicId: string) {
    const clinic = await this.prisma.clinic.findFirst({
      where: { id: clinicId, deletedAt: null },
      select: { hoursConfig: true },
    });
    return parseHoursOrDefault(clinic?.hoursConfig);
  }

  /**
   * Detect a time overlap with another non-deleted appointment for the
   * same clinic. `excludeId` is set during update so the row being
   * modified isn't counted as a conflict against itself.
   *
   * Two intervals overlap iff `aStart < bEnd && bStart < aEnd`. We use
   * a slightly conservative SQL filter (`scheduledFor < endInstant` AND
   * existing.scheduledFor + duration > startInstant). Because pg-prisma
   * can't express the arithmetic cleanly with `Prisma.VisitWhereInput`,
   * we fetch any appointment-style visit that *starts* inside `[start - 3h, end]` and
   * intersect in JS. 3h is well above the schema cap (180m).
   */
  private async findConflict(
    clinicId: string,
    start: Date,
    durationMinutes: number,
    excludeId: string | null,
  ): Promise<{ id: string } | null> {
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const lookbackStart = new Date(start.getTime() - 3 * 60 * 60_000);
    const rows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        ...APPT_BASE_WHERE,
        status: { in: ['scheduled', 'arrived', 'in_progress', 'completed'] },
        scheduledFor: { gte: lookbackStart, lt: end },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true, scheduledFor: true, durationMinutes: true },
    });
    for (const r of rows) {
      if (r.scheduledFor == null) continue;
      const duration = r.durationMinutes ?? 0;
      const rEnd = new Date(r.scheduledFor.getTime() + duration * 60_000);
      if (r.scheduledFor < end && rEnd > start) {
        return { id: r.id };
      }
    }
    return null;
  }

  private toDto(
    row: {
      id: string;
      patientId: string;
      scheduledFor: Date | null;
      durationMinutes: number | null;
      status: string;
      createdAt: Date;
      updatedAt: Date;
      patient: { firstName: string; lastName: string; dateOfBirth: Date | string | null };
    },
    lastVisitMap: Map<string, Date>,
  ): AppointmentDto {
    const lastVisit = lastVisitMap.get(row.patientId) ?? null;
    return {
      id: row.id,
      patientId: row.patientId,
      patient: {
        firstName: row.patient.firstName,
        lastName: row.patient.lastName,
        dateOfBirth: this.serializeDob(row.patient.dateOfBirth),
      },
      // The appointments surface only ever receives rows where
      // `scheduledFor IS NOT NULL` (filtered at every query), but the
      // column is optional in the schema so we narrow once at the DTO
      // boundary.
      scheduledFor: row.scheduledFor!.toISOString(),
      durationMinutes: row.durationMinutes ?? 0,
      status: narrowStatusForAppointment(row.status),
      lastVisitAt: lastVisit ? lastVisit.toISOString() : null,
      isNewPatient: lastVisit == null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeDob(dob: Date | string | null): string | null {
    if (!dob) return null;
    const d = typeof dob === 'string' ? new Date(dob) : dob;
    if (Number.isNaN(d.getTime())) return null;
    const iso = d.toISOString().slice(0, 10);
    // The receptionist quick-add sentinel (`1900-01-01`) means "DOB
    // not yet captured" — surface as null so the calendar shows "—".
    if (iso === '1900-01-01') return null;
    return iso;
  }

  /**
   * Map each patientId → most-recent visit date. Used to compute the
   * color indicator + isNewPatient on every appointment DTO without an
   * N+1 lookup. One round-trip per list call.
   */
  private async fetchLastVisitMap(
    clinicId: string,
    patientIds: string[],
  ): Promise<Map<string, Date>> {
    if (patientIds.length === 0) return new Map();
    const unique = Array.from(new Set(patientIds));
    // Only completed visits count toward the "recent clinical visit"
    // signal. Post-merge the `visits` table also stores scheduled rows
    // whose `visitDate` reflects a future booking, not a clinical
    // encounter — those must not bias the color indicator.
    const rows = await this.prisma.visit.groupBy({
      by: ['patientId'],
      where: {
        clinicId,
        patientId: { in: unique },
        deletedAt: null,
        status: 'completed',
      },
      _max: { visitDate: true },
    });
    const map = new Map<string, Date>();
    for (const r of rows) {
      if (r._max.visitDate) {
        const d = typeof r._max.visitDate === 'string'
          ? new Date(r._max.visitDate)
          : r._max.visitDate;
        map.set(r.patientId, d);
      }
    }
    return map;
  }

  private hoursMessageFor(reason: 'closed_day' | 'before_open' | 'after_close' | undefined): string {
    switch (reason) {
      case 'closed_day':
        return 'Klinika është e mbyllur këtë ditë.';
      case 'before_open':
        return 'Ora është para hapjes së klinikës.';
      case 'after_close':
        return 'Termini kalon orarin e mbylljes.';
      default:
        return 'Orari nuk është i vlefshëm.';
    }
  }
}
