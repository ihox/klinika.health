import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { localDateToday, utcMidnight } from '../../common/datetime';
import type { RequestContext } from '../../common/request-context/request-context';
import { hasClinicalAccess } from '../../common/request-context/role-helpers';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type ChartGrowthPointDto,
  type ChartVertetimDto,
  type ChartVisitDto,
  type PatientChartDto,
} from './patient-chart.dto';
import { toFullDto } from './patients.dto';

/**
 * Patient chart loader — doctor / clinic-admin only.
 *
 * Returns the master record, the full visit timeline (most recent
 * first), and the issued vërtetime list in a single round-trip so
 * the chart shell renders without a waterfall.
 *
 * Receptionists are blocked at the controller (`@Roles('doctor',
 * 'clinic_admin')`) — this service rechecks defensively but the
 * controller is the contract boundary.
 *
 * RLS provides the second layer: even a tampered controller would
 * see only clinic-scoped rows.
 */
@Injectable()
export class PatientChartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async getChart(
    clinicId: string,
    patientId: string,
    ctx: RequestContext,
  ): Promise<PatientChartDto> {
    if (!hasClinicalAccess(ctx.roles)) {
      throw new ForbiddenException('Vetëm mjeku ka qasje në këtë veprim.');
    }
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Pacienti nuk u gjet.');

    const today = utcMidnight(localDateToday());
    const [visits, vertetime] = await Promise.all([
      this.prisma.visit.findMany({
        // Post-merge (ADR-011): the unified `visits` table holds both
        // scheduled appointments and clinical visits. The chart's
        // history list is "vizita të mëparshme" — rows the doctor has
        // actually touched — so we narrow to `status IN ('completed',
        // 'in_progress')`. Scheduled / arrived rows from today are
        // included so the doctor's chart surfaces today's booking as
        // the editable form (eliminates the "+ Vizitë e re" conflict
        // when a receptionist has already scheduled the patient).
        // No_show rows stay excluded — that's a receptionist-controlled
        // lifecycle state and the doctor's history list should not
        // surface it.
        where: {
          clinicId,
          patientId,
          deletedAt: null,
          OR: [
            { status: { in: ['completed', 'in_progress'] } },
            {
              status: { in: ['scheduled', 'arrived'] },
              visitDate: today,
            },
          ],
        },
        orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          diagnoses: {
            orderBy: { orderIndex: 'asc' },
            include: {
              code: { select: { code: true, latinDescription: true } },
            },
            take: 1,
          },
        },
      }),
      this.prisma.vertetim.findMany({
        where: { clinicId, patientId },
        orderBy: { issuedAt: 'desc' },
      }),
    ]);

    const growthPoints = buildGrowthPoints(patient.dateOfBirth, visits);

    // Sensitive read — record a single audit row covering the entire
    // chart open. Per CLAUDE.md §5.3, sensitive reads carry
    // `changes: null` so the row exists for forensic timelines
    // without writing patient data.
    await this.audit.record({
      ctx,
      action: 'patient.chart.viewed',
      resourceType: 'patient',
      resourceId: patientId,
      changes: null,
    });

    const visitDtos: ChartVisitDto[] = visits.map((v) => ({
      id: v.id,
      visitDate: dateToIso(v.visitDate),
      status: v.status,
      primaryDiagnosis: v.diagnoses[0]
        ? {
            code: v.diagnoses[0].code.code,
            latinDescription: v.diagnoses[0].code.latinDescription,
          }
        : null,
      legacyDiagnosis: v.legacyDiagnosis ?? null,
      paymentCode: v.paymentCode ?? null,
      updatedAt: v.updatedAt.toISOString(),
    }));

    const vertetimDtos: ChartVertetimDto[] = vertetime.map((c) => ({
      id: c.id,
      visitId: c.visitId,
      issuedAt: c.issuedAt.toISOString(),
      absenceFrom: dateToIso(c.absenceFrom),
      absenceTo: dateToIso(c.absenceTo),
      durationDays: daysInclusive(c.absenceFrom, c.absenceTo),
      diagnosisSnapshot: c.diagnosisSnapshot,
    }));

    return {
      patient: toFullDto(patient),
      visits: visitDtos,
      vertetime: vertetimDtos,
      daysSinceLastVisit: computeDaysSince(visits[0]?.visitDate ?? null, new Date()),
      visitCount: visits.length,
      growthPoints,
    };
  }
}

// ===========================================================================
// Pure helpers (exported for unit tests)
// ===========================================================================

export function dateToIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function daysInclusive(from: Date, to: Date): number {
  const ms = startOfDayUtc(to).getTime() - startOfDayUtc(from).getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

export function computeDaysSince(
  lastVisitDate: Date | null,
  asOf: Date,
): number | null {
  if (!lastVisitDate) return null;
  const ms = startOfDayUtc(asOf).getTime() - startOfDayUtc(lastVisitDate).getTime();
  const days = Math.floor(ms / 86_400_000);
  // Future-dated visits (e.g. a scheduled-but-pre-charted visit row)
  // shouldn't surface as negative ages on the color indicator. Clamp
  // to zero — the master strip still renders "0 ditë" in green.
  return Math.max(0, days);
}

function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

interface GrowthVisitRow {
  id: string;
  visitDate: Date;
  createdAt: Date;
  weightG: number | null;
  heightCm: { toString(): string } | null;
  headCircumferenceCm: { toString(): string } | null;
}

/**
 * Build the growth-point series for the chart bundle. One row per
 * non-deleted visit that recorded at least one of weight, height, or
 * head circumference. Points are emitted oldest-first so the WHO
 * sparklines and modal can stream them without sorting.
 *
 * When the visit lacks a `visitDate` we fall back to `createdAt` per
 * the slice spec — the field-level NOT NULL on `visitDate` makes this
 * a defensive no-op today, but it costs nothing to keep the contract
 * explicit.
 */
export function buildGrowthPoints(
  dateOfBirth: Date | null,
  visits: GrowthVisitRow[],
): ChartGrowthPointDto[] {
  if (!dateOfBirth) return [];
  const points: ChartGrowthPointDto[] = [];
  for (const v of visits) {
    const weightKg =
      v.weightG != null && Number.isFinite(v.weightG) ? v.weightG / 1000 : null;
    const heightCm = v.heightCm != null ? Number(v.heightCm.toString()) : null;
    const headCircumferenceCm =
      v.headCircumferenceCm != null ? Number(v.headCircumferenceCm.toString()) : null;
    if (weightKg == null && heightCm == null && headCircumferenceCm == null) {
      continue;
    }
    const visitDate = v.visitDate ?? v.createdAt;
    const ageMonths = monthsBetween(dateOfBirth, visitDate);
    points.push({
      visitId: v.id,
      visitDate: dateToIso(visitDate),
      ageMonths,
      weightKg,
      heightCm: heightCm != null && Number.isFinite(heightCm) ? heightCm : null,
      headCircumferenceCm:
        headCircumferenceCm != null && Number.isFinite(headCircumferenceCm)
          ? headCircumferenceCm
          : null,
    });
  }
  // visits arrive newest-first from the chart loader — emit oldest-
  // first for the time-axis-aligned plot.
  points.reverse();
  return points;
}

/**
 * Whole months between DOB and a visit date, calendar-aware (not
 * ms/30-day approximations). Matches the front-end `ageLabelChart`
 * derivation so the sparkline x-axis lines up with the master-strip
 * "2v 3m" label.
 *
 * Returns 0 when the visit predates the DOB (paranoia — shouldn't
 * happen but the chart shouldn't crash on bad data).
 */
export function monthsBetween(dob: Date, visit: Date): number {
  if (visit.getTime() < dob.getTime()) return 0;
  let months =
    (visit.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    (visit.getUTCMonth() - dob.getUTCMonth());
  if (visit.getUTCDate() < dob.getUTCDate()) months -= 1;
  return Math.max(0, months);
}
