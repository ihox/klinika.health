import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Either the root PrismaService or a transaction-scoped client. The
 * walk-in helper accepts both so callers wrapping the creation in a
 * `$transaction` can compute arrived_at against the in-flight tx
 * (avoiding races with other walk-ins committed mid-flight).
 */
type WalkInPrismaClient =
  | Prisma.TransactionClient
  | Pick<import('../../prisma/prisma.service').PrismaService, 'visit'>;

import { AuditLogService, type AuditFieldDiff } from '../../common/audit/audit-log.service';
import { localDateToday, utcMidnight } from '../../common/datetime';
import { isReceptionistOnly } from '../../common/request-context/role-helpers';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { parseHoursOrDefault } from '../clinic-settings/clinic-settings.service';
import {
  type CalendarAvailabilityResponse,
  type CalendarEntryDto,
  type CalendarListResponse,
  type CalendarStatsResponse,
  CLINICAL_DATA_REFUSAL_MESSAGE,
  type CreateScheduledVisitInput,
  type CreateWalkinVisitInput,
  hasClinicalData,
  isTransitionAllowed,
  type SoftDeleteResponse,
  type UpdateScheduledVisitInput,
  type UpdateVisitStatusInput,
  VISIT_STATUSES,
  type VisitStatus,
  WALKIN_PAIRING_REFUSAL_MESSAGE,
} from './visits-calendar.dto';
import { computeAvailability, type OccupiedInterval } from './visits-calendar.availability';
import { VisitsCalendarEventsService } from './visits-calendar.events';
import { fitsInsideHours, toMinutes } from './visits-calendar.hours';
import { localClockToUtc, utcToLocalParts } from './visits-calendar.tz';

interface RangeIso {
  from: string;
  to: string;
}

/**
 * Predicate that selects calendar-visible rows: scheduled bookings
 * (`scheduled_for IS NOT NULL`) and walk-ins. A doctor-only clinical
 * visit — created via "[Vizitë e re]" with no booking and no walk-in
 * flag — never appears in the calendar feed.
 */
const CALENDAR_VISIBLE_WHERE: Prisma.VisitWhereInput = {
  OR: [
    { scheduledFor: { not: null } },
    { isWalkIn: true },
  ],
};

@Injectable()
export class VisitsCalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly events: VisitsCalendarEventsService,
  ) {}

  // -------------------------------------------------------------------------
  // List a date range
  // -------------------------------------------------------------------------

  async listRange(
    clinicId: string,
    range: RangeIso,
    ctx: RequestContext,
  ): Promise<CalendarListResponse> {
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
        OR: [
          // Scheduled bookings (also covers bookings that progressed to
          // arrived / in_progress / completed — scheduled_for stays set).
          { scheduledFor: { gte: fromUtc, lte: toUtc } },
          // Walk-ins, anchored to their arrival instant.
          { isWalkIn: true, arrivedAt: { gte: fromUtc, lte: toUtc } },
        ],
      },
      orderBy: [{ scheduledFor: 'asc' }, { arrivedAt: 'asc' }],
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, rows.map((r) => r.patientId));
    const filtered = rows.filter((r) => {
      const anchor = r.scheduledFor ?? r.arrivedAt;
      if (anchor == null) return false;
      const { date } = utcToLocalParts(anchor);
      return date >= range.from && date <= range.to;
    });
    const showClinical = !isReceptionistOnly(ctx.roles);
    return {
      entries: filtered.map((r) => this.toDto(r, lastVisitMap, showClinical)),
      serverTime: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Stats for one local day
  // -------------------------------------------------------------------------

  async statsForDay(clinicId: string, dateIso: string): Promise<CalendarStatsResponse> {
    const dayStartUtc = new Date(localClockToUtc(dateIso, '00:00').getTime() - 86_400_000);
    const dayEndUtc = new Date(localClockToUtc(dateIso, '23:59').getTime() + 86_400_000);

    const rows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        OR: [
          { scheduledFor: { gte: dayStartUtc, lte: dayEndUtc } },
          { isWalkIn: true, arrivedAt: { gte: dayStartUtc, lte: dayEndUtc } },
        ],
      },
      orderBy: [{ scheduledFor: 'asc' }, { arrivedAt: 'asc' }],
      include: {
        patient: { select: { firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    const onDay = rows.filter((r) => {
      const anchor = r.scheduledFor ?? r.arrivedAt;
      if (anchor == null) return false;
      return utcToLocalParts(anchor).date === dateIso;
    });

    const counts: Record<VisitStatus, number> = {
      scheduled: 0,
      arrived: 0,
      in_progress: 0,
      completed: 0,
      no_show: 0,
      cancelled: 0,
    };
    let walkInCount = 0;
    let firstStart: Date | null = null;
    let lastEnd: Date | null = null;
    let paymentTotalCents = 0;

    const paymentCodes = await this.clinicPaymentCodes(clinicId);

    for (const r of onDay) {
      const status = narrowToVisitStatus(r.status);
      counts[status] += 1;
      if (r.isWalkIn) walkInCount += 1;

      const start = r.scheduledFor ?? r.arrivedAt;
      const duration = r.durationMinutes ?? 0;
      if (start && (!firstStart || start < firstStart)) firstStart = start;
      const endAt = start ? new Date(start.getTime() + duration * 60_000) : null;
      if (endAt && (!lastEnd || endAt > lastEnd)) lastEnd = endAt;

      if (status === 'completed' && r.paymentCode) {
        paymentTotalCents += paymentCodes[r.paymentCode]?.amountCents ?? 0;
      }
    }

    const now = new Date();
    const upcoming = onDay
      .filter(
        (r) =>
          r.scheduledFor != null &&
          narrowToVisitStatus(r.status) === 'scheduled' &&
          r.scheduledFor >= now,
      )
      .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime());
    const next = upcoming[0] ?? null;

    return {
      date: dateIso,
      total: onDay.length,
      scheduled: counts.scheduled,
      walkIn: walkInCount,
      arrived: counts.arrived,
      inProgress: counts.in_progress,
      completed: counts.completed,
      noShow: counts.no_show,
      cancelled: counts.cancelled,
      firstStart: firstStart ? firstStart.toISOString() : null,
      lastEnd: lastEnd ? lastEnd.toISOString() : null,
      paymentTotalCents,
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
  // Unmarked-past prompt
  // -------------------------------------------------------------------------

  /**
   * Past-day scheduled bookings the receptionist hasn't transitioned yet.
   * Walk-ins are deliberately excluded — they never enter 'scheduled' so
   * there's nothing for the receptionist to clean up later.
   */
  async listUnmarkedPast(
    clinicId: string,
    ctx: RequestContext,
  ): Promise<CalendarEntryDto[]> {
    const lookbackUtcStart = new Date(Date.now() - 7 * 86_400_000);
    // Canonical "today in Belgrade" via the shared helper — matches
    // doctor-dashboard.service.ts § "today's visit log".
    const today = localDateToday();
    const todayStartUtc = localClockToUtc(today, '00:00');

    const rows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        scheduledFor: { gte: lookbackUtcStart, lt: todayStartUtc, not: null },
        status: 'scheduled',
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
    const showClinical = !isReceptionistOnly(ctx.roles);
    return rows.map((r) => this.toDto(r, lastVisitMap, showClinical));
  }

  // -------------------------------------------------------------------------
  // Create scheduled
  // -------------------------------------------------------------------------

  async createScheduled(
    clinicId: string,
    payload: CreateScheduledVisitInput,
    ctx: RequestContext,
  ): Promise<CalendarEntryDto> {
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

    const created = await this.prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        visitDate: utcMidnight(payload.date),
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
      action: 'visit.scheduled',
      resourceType: 'visit',
      resourceId: created.id,
      changes: [
        { field: 'patientId', old: null, new: payload.patientId },
        { field: 'scheduledFor', old: null, new: created.scheduledFor!.toISOString() },
        { field: 'durationMinutes', old: null, new: created.durationMinutes },
        { field: 'status', old: null, new: created.status },
      ],
    });

    this.events.emit({
      type: 'visit.created',
      clinicId,
      visitId: created.id,
      localDate: utcToLocalParts(created.scheduledFor!).date,
      isWalkIn: false,
      status: created.status,
      emittedAt: new Date().toISOString(),
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [patient.id]);
    return this.toDto(created, lastVisitMap, !isReceptionistOnly(ctx.roles));
  }

  // -------------------------------------------------------------------------
  // Create walk-in
  // -------------------------------------------------------------------------

  async createWalkin(
    clinicId: string,
    payload: CreateWalkinVisitInput,
    ctx: RequestContext,
  ): Promise<CalendarEntryDto> {
    if (!ctx.userId) throw new ForbiddenException('Pa përdorues.');

    const patient = await this.prisma.patient.findFirst({
      where: { id: payload.patientId, clinicId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
    });
    if (!patient) throw new NotFoundException('Pacienti nuk u gjet.');

    // Pairing validation per CLAUDE.md §13 (walk-in pairing rule).
    // A walk-in always pairs to a scheduled visit in the same clinic;
    // the pairing is logical (shared visual row), not temporal, so we
    // don't constrain by time. The paired visit must:
    //   - exist in the same clinic
    //   - not be soft-deleted
    //   - have `scheduledFor !== null` (i.e. be a booking, not a
    //     walk-in itself)
    //   - not be in status='completed' (the visit is finished — there
    //     is no longer a "patient currently being seen" to share a row
    //     with)
    // Any other failure mode returns the same single Albanian error to
    // avoid leaking visit identity probing.
    const pairedWith = await this.prisma.visit.findFirst({
      where: {
        id: payload.pairedWithVisitId,
        clinicId,
        deletedAt: null,
        scheduledFor: { not: null },
        isWalkIn: false,
        status: { not: 'completed' },
      },
      select: { id: true },
    });
    if (!pairedWith) {
      throw new BadRequestException({
        message: WALKIN_PAIRING_REFUSAL_MESSAGE,
        reason: 'walkin_pairing_invalid',
      });
    }

    // Walk-ins skip 'scheduled'. Default initial state is 'arrived'
    // (receptionist registers, doctor sees them shortly); the
    // receptionist may also open in 'in_progress' when the doctor takes
    // the patient straight in. No other initial states are allowed —
    // the DTO Zod schema enforces it.
    const initialStatus: 'arrived' | 'in_progress' = payload.initialStatus ?? 'arrived';
    const [arrivedAt, durationMinutes] = await Promise.all([
      this.computeWalkInArrivedAt(clinicId, new Date()),
      this.getClinicWalkInDuration(clinicId),
    ]);

    const created = await this.prisma.visit.create({
      data: {
        clinicId,
        patientId: patient.id,
        // Walk-ins anchor to today's local date. The visit_date column
        // is DATE (not Timestamptz) — `utcMidnight(localDateToday())`
        // is the canonical pattern (ADR-006 §DATE vs Timestamptz).
        visitDate: utcMidnight(localDateToday()),
        scheduledFor: null,
        durationMinutes,
        isWalkIn: true,
        arrivedAt,
        status: initialStatus,
        pairedWithVisitId: pairedWith.id,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });

    await this.audit.record({
      ctx,
      action: 'visit.walkin.added',
      resourceType: 'visit',
      resourceId: created.id,
      changes: [
        { field: 'patientId', old: null, new: payload.patientId },
        { field: 'isWalkIn', old: null, new: true },
        { field: 'arrivedAt', old: null, new: arrivedAt.toISOString() },
        { field: 'status', old: null, new: created.status },
        { field: 'pairedWithVisitId', old: null, new: pairedWith.id },
      ],
    });

    const emittedAt = new Date().toISOString();
    this.events.emit({
      type: 'visit.created',
      clinicId,
      visitId: created.id,
      localDate: localDateToday(),
      isWalkIn: true,
      status: created.status,
      emittedAt,
    });
    // Phase 2b — secondary "arrival" event for the doctor's home toast.
    // Fires *alongside* visit.created so the calendar/dashboard refresh
    // still happens once (driven by visit.created); the toast handler
    // ignores its own session via `actorUserId`.
    this.events.emit({
      type: 'visit.walkin.added',
      clinicId,
      visitId: created.id,
      localDate: localDateToday(),
      isWalkIn: true,
      status: created.status,
      emittedAt,
      actorUserId: ctx.userId,
      patientName: `${patient.firstName} ${patient.lastName}`,
      pairedWithVisitId: pairedWith.id,
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [patient.id]);
    return this.toDto(created, lastVisitMap, !isReceptionistOnly(ctx.roles));
  }

  // -------------------------------------------------------------------------
  // Update scheduled (reschedule)
  // -------------------------------------------------------------------------

  async updateScheduled(
    clinicId: string,
    id: string,
    payload: UpdateScheduledVisitInput,
    ctx: RequestContext,
  ): Promise<CalendarEntryDto> {
    const before = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: null, ...CALENDAR_VISIBLE_WHERE },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    if (!before) throw new NotFoundException('Vizita nuk u gjet.');
    if (before.isWalkIn || before.scheduledFor == null) {
      // Walk-ins can't be moved — there's no booking time to relocate.
      throw new BadRequestException({
        message: 'Vizita pa termin nuk mund të zhvendoset.',
        reason: 'walkin_immovable',
      });
    }

    const targetDate = payload.date ?? utcToLocalParts(before.scheduledFor).date;
    const targetTime = payload.time ?? utcToLocalParts(before.scheduledFor).time;
    const targetDuration = payload.durationMinutes ?? before.durationMinutes ?? 0;

    const hours = await this.clinicHours(clinicId);
    const startMin = toMinutes(targetTime);
    const fit = fitsInsideHours(hours, targetDate, startMin, targetDuration);
    if (!fit.fits) {
      throw new BadRequestException({
        message: this.hoursMessageFor(fit.reason),
        reason: fit.reason,
      });
    }
    const nextScheduledFor = localClockToUtc(targetDate, targetTime);
    const conflict = await this.findConflict(clinicId, nextScheduledFor, targetDuration, id);
    if (conflict) {
      throw new BadRequestException({
        message: 'Ky orar mbivendoset me një termin tjetër.',
        reason: 'conflict',
      });
    }

    const data: Prisma.VisitUpdateInput = {};
    const diffs: AuditFieldDiff[] = [];
    if (nextScheduledFor.getTime() !== before.scheduledFor.getTime()) {
      data.scheduledFor = nextScheduledFor;
      data.visitDate = utcMidnight(targetDate);
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
    if (diffs.length === 0) {
      const lastVisitMap = await this.fetchLastVisitMap(clinicId, [before.patientId]);
      return this.toDto(before, lastVisitMap, !isReceptionistOnly(ctx.roles));
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
      action: 'visit.rescheduled',
      resourceType: 'visit',
      resourceId: id,
      changes: diffs,
    });
    this.events.emit({
      type: 'visit.updated',
      clinicId,
      visitId: id,
      localDate: utcToLocalParts(after.scheduledFor!).date,
      isWalkIn: after.isWalkIn,
      status: after.status,
      emittedAt: new Date().toISOString(),
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [after.patientId]);
    return this.toDto(after, lastVisitMap, !isReceptionistOnly(ctx.roles));
  }

  // -------------------------------------------------------------------------
  // Status transition
  // -------------------------------------------------------------------------

  async changeStatus(
    clinicId: string,
    id: string,
    payload: UpdateVisitStatusInput,
    ctx: RequestContext,
  ): Promise<CalendarEntryDto> {
    const before = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: null, ...CALENDAR_VISIBLE_WHERE },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    if (!before) throw new NotFoundException('Vizita nuk u gjet.');

    const from = narrowToVisitStatus(before.status);
    const to = payload.status;
    if (!isTransitionAllowed(from, to)) {
      throw new BadRequestException({
        message: `Tranzicioni nga "${from}" në "${to}" nuk lejohet.`,
        reason: 'invalid_transition',
        from,
        to,
      });
    }

    // Side-effects keyed off the target state:
    //   - arrived: stamp `arrived_at` if it isn't set yet (first transition).
    //   - in_progress / completed / no_show / cancelled: leave timestamps as-is.
    // Walk-ins always already have arrived_at set; bookings get it on
    // the first scheduled→arrived (or completed→arrived rewind).
    const data: Prisma.VisitUpdateInput = { status: to };
    const diffs: AuditFieldDiff[] = [
      { field: 'status', old: from, new: to },
    ];
    if (to === 'arrived' && before.arrivedAt == null) {
      const now = new Date();
      data.arrivedAt = now;
      diffs.push({ field: 'arrivedAt', old: null, new: now.toISOString() });
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
      action: 'visit.status_changed',
      resourceType: 'visit',
      resourceId: id,
      changes: diffs,
    });
    const anchor = after.scheduledFor ?? after.arrivedAt;
    this.events.emit({
      type: 'visit.status_changed',
      clinicId,
      visitId: id,
      localDate: anchor ? utcToLocalParts(anchor).date : utcToLocalParts(new Date()).date,
      isWalkIn: after.isWalkIn,
      status: after.status,
      previousStatus: from,
      emittedAt: new Date().toISOString(),
    });

    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [after.patientId]);
    return this.toDto(after, lastVisitMap, !isReceptionistOnly(ctx.roles));
  }

  // -------------------------------------------------------------------------
  // Soft delete + restore (calendar-scoped)
  // -------------------------------------------------------------------------

  async softDelete(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<SoftDeleteResponse> {
    const before = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: null, ...CALENDAR_VISIBLE_WHERE },
      include: { diagnoses: { select: { id: true } } },
    });
    if (!before) throw new NotFoundException('Vizita nuk u gjet.');

    // Receptionist deleting a row that already has clinical content is
    // refused — the doctor must use the chart-form "Pastro vizitën"
    // affordance (Phase 2c) instead. This guards both the privacy
    // boundary and the doctor's authoritative ownership of clinical
    // data.
    if (
      hasClinicalData({
        complaint: before.complaint,
        examinations: before.examinations,
        prescription: before.prescription,
        ultrasoundNotes: before.ultrasoundNotes,
        labResults: before.labResults,
        followupNotes: before.followupNotes,
        otherNotes: before.otherNotes,
        legacyDiagnosis: before.legacyDiagnosis,
        feedingNotes: before.feedingNotes,
        weightG: before.weightG,
        heightCm: before.heightCm,
        headCircumferenceCm: before.headCircumferenceCm,
        temperatureC: before.temperatureC,
        paymentCode: before.paymentCode,
        diagnosesCount: before.diagnoses.length,
      })
    ) {
      throw new ForbiddenException({
        message: CLINICAL_DATA_REFUSAL_MESSAGE,
        reason: 'has_clinical_data',
      });
    }

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
    const anchor = before.scheduledFor ?? before.arrivedAt;
    this.events.emit({
      type: 'visit.deleted',
      clinicId,
      visitId: id,
      localDate: anchor ? utcToLocalParts(anchor).date : utcToLocalParts(now).date,
      isWalkIn: before.isWalkIn,
      status: before.status,
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
  ): Promise<CalendarEntryDto> {
    // The soft-delete middleware AND-injects `deletedAt: null` to every
    // read on Visit. A top-level explicit `deletedAt: { not: null }`
    // opts out (with a Pino warning); ADR-011 finding #3 leaves a
    // cross-resource fix for later. We accept the warning here.
    const row = await this.prisma.visit.findFirst({
      where: { id, clinicId, deletedAt: { not: null }, ...CALENDAR_VISIBLE_WHERE },
    });
    if (!row) throw new NotFoundException('Vizita nuk u gjet.');
    const restored = await this.prisma.visit.update({
      where: { id },
      data: { deletedAt: null },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, dateOfBirth: true } },
      },
    });
    await this.audit.record({
      ctx,
      action: 'visit.restored',
      resourceType: 'visit',
      resourceId: id,
      changes: [{ field: 'deletedAt', old: row.deletedAt?.toISOString() ?? null, new: null }],
    });
    const anchor = restored.scheduledFor ?? restored.arrivedAt;
    this.events.emit({
      type: 'visit.restored',
      clinicId,
      visitId: id,
      localDate: anchor ? utcToLocalParts(anchor).date : utcToLocalParts(new Date()).date,
      isWalkIn: restored.isWalkIn,
      status: restored.status,
      emittedAt: new Date().toISOString(),
    });
    const lastVisitMap = await this.fetchLastVisitMap(clinicId, [restored.patientId]);
    return this.toDto(restored, lastVisitMap, !isReceptionistOnly(ctx.roles));
  }

  // -------------------------------------------------------------------------
  // Availability (booking dialog)
  // -------------------------------------------------------------------------

  async availability(
    clinicId: string,
    date: string,
    time: string,
    excludeId: string | null,
  ): Promise<CalendarAvailabilityResponse> {
    const hours = await this.clinicHours(clinicId);

    const dayStartUtc = new Date(localClockToUtc(date, '00:00').getTime() - 86_400_000);
    const dayEndUtc = new Date(localClockToUtc(date, '23:59').getTime() + 86_400_000);
    const dayRows = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        scheduledFor: { gte: dayStartUtc, lte: dayEndUtc, not: null },
        // Active or completed bookings block a slot. Walk-ins don't
        // occupy time slots (no scheduled_for) so they never enter
        // conflict math.
        status: { in: ['scheduled', 'arrived', 'in_progress', 'completed'] },
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true, scheduledFor: true, durationMinutes: true },
    });

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
  // Walk-in defaults (duration) — sourced from the clinic setting.
  // -------------------------------------------------------------------------

  /**
   * The clinic-configurable default duration (minutes) for new walk-ins.
   * Falls back to 5 (the schema default) if the row is somehow missing —
   * the FK on Visit.clinicId guarantees it isn't, but the safety keeps
   * the call total.
   */
  async getClinicWalkInDuration(clinicId: string): Promise<number> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      select: { walkinDurationMinutes: true },
    });
    return clinic?.walkinDurationMinutes ?? 5;
  }

  // -------------------------------------------------------------------------
  // Walk-in arrived_at policy: snap-to-5-min, stack-on-collision
  // -------------------------------------------------------------------------

  /**
   * Compute the `arrived_at` instant for a new walk-in.
   *
   * The receptionist creates walk-ins through `/api/visits/walkin`; the
   * doctor creates them through `/api/visits/doctor-new` (the
   * walk-in branch). Both paths flow through this helper so the time-
   * slot policy stays in one place:
   *
   *  1. Snap `intendedTime` to the nearest 5-minute UTC boundary.
   *  2. Compare against today's walk-in intervals
   *     `[arrived_at, arrived_at + duration_minutes)`; if the candidate
   *     falls inside any of them, advance by 5 minutes and try again.
   *  3. Stop when a free slot is found, or after 50 iterations (~4h of
   *     clock advance) as a safety against unexpected data.
   *
   * Lookups are scoped to the *snapped* instant's local day and pad
   * ±24h on the UTC query so DST drift never excludes a row anchored
   * near midnight. The JS filter then narrows to exactly the local day.
   *
   * Pass `prismaTx` to compute against an in-flight transaction.
   * Concurrent walk-ins outside a transaction may still race; that's
   * accepted for v1 (the worst case is two walk-ins sharing the same
   * arrived_at — extremely rare given the snap granularity).
   */
  async computeWalkInArrivedAt(
    clinicId: string,
    intendedTime: Date,
    prismaTx?: WalkInPrismaClient,
  ): Promise<Date> {
    const client = prismaTx ?? this.prisma;
    const snapped = snapToFiveMinutesUtc(intendedTime);
    const localDay = utcToLocalParts(snapped).date;
    const dayQueryStart = new Date(
      localClockToUtc(localDay, '00:00').getTime() - 86_400_000,
    );
    const dayQueryEnd = new Date(
      localClockToUtc(localDay, '23:59').getTime() + 86_400_000,
    );

    const existing = await client.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        isWalkIn: true,
        arrivedAt: { gte: dayQueryStart, lte: dayQueryEnd, not: null },
      },
      select: { arrivedAt: true, durationMinutes: true },
    });

    const intervals = existing
      .filter(
        (r): r is { arrivedAt: Date; durationMinutes: number | null } =>
          r.arrivedAt != null &&
          utcToLocalParts(r.arrivedAt).date === localDay,
      )
      .map((r) => {
        // A walk-in with a missing duration (legacy data) still occupies
        // at least its own 5-min cell so the stacker doesn't land on it.
        const duration = Math.max(5, r.durationMinutes ?? 5);
        return {
          startMs: r.arrivedAt.getTime(),
          endMs: r.arrivedAt.getTime() + duration * 60_000,
        };
      });

    const STEP_MS = 5 * 60_000;
    const MAX_ITER = 50;
    let candidateMs = snapped.getTime();
    for (let i = 0; i < MAX_ITER; i += 1) {
      const cMs = candidateMs;
      const occupied = intervals.some(
        (iv) => cMs >= iv.startMs && cMs < iv.endMs,
      );
      if (!occupied) return new Date(cMs);
      candidateMs = cMs + STEP_MS;
    }
    // Safety: cap reached. Return the last candidate so the caller still
    // gets a usable instant and the row creation can proceed.
    return new Date(candidateMs);
  }

  // -------------------------------------------------------------------------
  // Pairing helper for doctor-initiated walk-ins
  // -------------------------------------------------------------------------

  /**
   * Resolve the scheduled visit a doctor-initiated walk-in should pair
   * to. Used by the doctor's "Vizitë e re" flow where the sibling /
   * companion patient arrives without a booking and the doctor creates
   * the row from inside the chart.
   *
   * Selection order:
   *   1. The currently in-progress scheduled visit, if it doesn't yet
   *      have a walk-in paired to it.
   *   2. Otherwise the chronologically next scheduled-ish visit
   *      (`scheduled` / `arrived` / `in_progress`) that doesn't yet
   *      have a paired walk-in.
   *   3. Otherwise `null` — the caller should fall back to the
   *      calendar-invisible "standalone chart entry" path.
   *
   * Deterministic: same input → same paired row. A concurrent doctor
   * pairing race is accepted (one wins, the other ends up pointing at
   * the next slot or falling back).
   */
  async findNextUnpairedScheduledVisit(
    clinicId: string,
    forDate: string,
  ): Promise<{ id: string; scheduledFor: Date | null } | null> {
    const dayStartUtc = new Date(localClockToUtc(forDate, '00:00').getTime() - 86_400_000);
    const dayEndUtc = new Date(localClockToUtc(forDate, '23:59').getTime() + 86_400_000);

    // Candidates: every active booking on the day (not walk-ins, not
    // completed / cancelled / no-show — once a visit is finalized the
    // sibling row would lose its "shared row" anchor).
    const candidates = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        isWalkIn: false,
        scheduledFor: { gte: dayStartUtc, lte: dayEndUtc, not: null },
        status: { in: ['scheduled', 'arrived', 'in_progress'] },
      },
      orderBy: { scheduledFor: 'asc' },
      select: { id: true, scheduledFor: true, status: true },
    });
    const onDay = candidates.filter(
      (r) =>
        r.scheduledFor != null && utcToLocalParts(r.scheduledFor).date === forDate,
    );
    if (onDay.length === 0) return null;

    const candidateIds = onDay.map((r) => r.id);
    const pairedWalkIns = await this.prisma.visit.findMany({
      where: {
        clinicId,
        deletedAt: null,
        isWalkIn: true,
        pairedWithVisitId: { in: candidateIds },
      },
      select: { pairedWithVisitId: true },
    });
    const taken = new Set(
      pairedWalkIns
        .map((r) => r.pairedWithVisitId)
        .filter((v): v is string => v != null),
    );

    const inProgress = onDay.find((r) => r.status === 'in_progress');
    if (inProgress && !taken.has(inProgress.id)) {
      return { id: inProgress.id, scheduledFor: inProgress.scheduledFor };
    }
    const next = onDay.find((r) => !taken.has(r.id));
    return next ? { id: next.id, scheduledFor: next.scheduledFor } : null;
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

  private async clinicPaymentCodes(
    clinicId: string,
  ): Promise<Record<string, { label: string; amountCents: number }>> {
    const clinic = await this.prisma.clinic.findFirst({
      where: { id: clinicId, deletedAt: null },
      select: { paymentCodes: true },
    });
    const raw = clinic?.paymentCodes as unknown;
    if (raw == null || typeof raw !== 'object') return {};
    const out: Record<string, { label: string; amountCents: number }> = {};
    for (const [code, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (entry == null || typeof entry !== 'object') continue;
      const obj = entry as { label?: unknown; amountCents?: unknown };
      const label = typeof obj.label === 'string' ? obj.label : '';
      const amountCents = typeof obj.amountCents === 'number' ? obj.amountCents : 0;
      out[code] = { label, amountCents };
    }
    return out;
  }

  /**
   * Detect a time overlap with another non-deleted, non-walkin visit
   * for the same clinic. `excludeId` is set during update so the row
   * being modified isn't counted as a conflict against itself.
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
        scheduledFor: { gte: lookbackStart, lt: end, not: null },
        status: { in: ['scheduled', 'arrived', 'in_progress', 'completed'] },
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
      arrivedAt: Date | null;
      isWalkIn: boolean;
      status: string;
      paymentCode: string | null;
      createdAt: Date;
      updatedAt: Date;
      patient: { firstName: string; lastName: string; dateOfBirth: Date | string | null };
    },
    lastVisitMap: Map<string, Date>,
    showClinical: boolean = true,
  ): CalendarEntryDto {
    const lastVisit = lastVisitMap.get(row.patientId) ?? null;
    return {
      id: row.id,
      patientId: row.patientId,
      patient: {
        firstName: row.patient.firstName,
        lastName: row.patient.lastName,
        dateOfBirth: this.serializeDob(row.patient.dateOfBirth),
      },
      scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
      durationMinutes: row.durationMinutes,
      arrivedAt: row.arrivedAt ? row.arrivedAt.toISOString() : null,
      status: narrowToVisitStatus(row.status),
      isWalkIn: row.isWalkIn,
      // CLAUDE.md §1.2: receptionist-only callers never see per-row
      // payment codes. Aggregate day total lives in /calendar/stats and
      // is non-PHI. Default `showClinical=true` keeps writes (which
      // resolve the caller's row directly) from leaking, but callers
      // SHOULD pass the role-derived flag explicitly.
      paymentCode: showClinical ? normalisePaymentCode(row.paymentCode) : null,
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
    if (iso === '1900-01-01') return null;
    return iso;
  }

  private async fetchLastVisitMap(
    clinicId: string,
    patientIds: string[],
  ): Promise<Map<string, Date>> {
    if (patientIds.length === 0) return new Map();
    const unique = Array.from(new Set(patientIds));
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

  private hoursMessageFor(
    reason: 'closed_day' | 'before_open' | 'after_close' | undefined,
  ): string {
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

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Snap a UTC instant to the nearest 5-minute boundary, zeroing seconds
 * and milliseconds. Equivalent to a local-time snap for any whole-hour
 * timezone offset (Europe/Belgrade is +1/+2 — both whole hours).
 *
 *   10:03:00 → 10:05:00   (3 min from :00, 2 from :05 — :05 wins)
 *   10:02:00 → 10:00:00   (2 min from :00, 3 from :05 — :00 wins)
 *   10:02:30 → 10:05:00   (half-up via Math.round on UTC ms)
 *   11:50:00 → 11:50:00   (already on boundary)
 */
export function snapToFiveMinutesUtc(d: Date): Date {
  const fiveMinMs = 5 * 60_000;
  return new Date(Math.round(d.getTime() / fiveMinMs) * fiveMinMs);
}

function narrowToVisitStatus(value: string): VisitStatus {
  if ((VISIT_STATUSES as readonly string[]).includes(value)) {
    return value as VisitStatus;
  }
  // Defensive: a row with an unexpected status falls back to 'scheduled'
  // (the only state the CHECK constraint can deliver without a code change
  // and a migration would be a 'scheduled' equivalent for the calendar's
  // purposes).
  return 'scheduled';
}

function normalisePaymentCode(value: string | null): 'A' | 'B' | 'C' | 'D' | 'E' | null {
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'E') {
    return value;
  }
  return null;
}
