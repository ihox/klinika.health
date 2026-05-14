import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
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
    if (ctx.role !== 'doctor' && ctx.role !== 'clinic_admin') {
      throw new ForbiddenException('Vetëm mjeku ka qasje në këtë veprim.');
    }
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Pacienti nuk u gjet.');

    const [visits, vertetime] = await Promise.all([
      this.prisma.visit.findMany({
        where: { clinicId, patientId, deletedAt: null },
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
