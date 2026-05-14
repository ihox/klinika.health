import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type IssueVertetimInput,
  type VertetimDto,
} from './vertetim.dto';

/**
 * Vërtetim service — issue + fetch.
 *
 * Issuing a vërtetim freezes the visit's primary diagnosis text at
 * the moment of issue. Reprints (via the print module) use the
 * snapshot, never the live visit. This protects against the doctor
 * editing the diagnosis after the school has filed the certificate.
 *
 * Vërtetime are immutable in v1 — no update, no soft delete. If a
 * mistake is made, the doctor issues a corrected one with a new
 * number; the old one stays in the log as the audit trail.
 */
@Injectable()
export class VertetimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async issue(
    clinicId: string,
    payload: IssueVertetimInput,
    ctx: RequestContext,
  ): Promise<VertetimDto> {
    this.requireDoctorOrAdmin(ctx);
    if (!ctx.userId) {
      throw new ForbiddenException('Sesioni i pavlefshëm.');
    }

    const visit = await this.prisma.visit.findFirst({
      where: { id: payload.visitId, clinicId, deletedAt: null },
      include: {
        patient: { select: { id: true } },
        diagnoses: {
          include: { code: true },
          orderBy: { orderIndex: 'asc' },
          take: 1,
        },
      },
    });
    if (!visit) throw new NotFoundException('Vizita nuk u gjet.');

    const snapshot = buildDiagnosisSnapshot(visit);
    const issuedAt = new Date();

    const created = await this.prisma.vertetim.create({
      data: {
        clinicId,
        patientId: visit.patient.id,
        visitId: visit.id,
        issuedBy: ctx.userId,
        issuedAt,
        absenceFrom: new Date(`${payload.absenceFrom}T00:00:00Z`),
        absenceTo: new Date(`${payload.absenceTo}T00:00:00Z`),
        diagnosisSnapshot: snapshot,
      },
    });

    await this.audit.record({
      ctx,
      action: 'print.vertetim.issued',
      resourceType: 'vertetim',
      resourceId: created.id,
      changes: [
        { field: 'visitId', old: null, new: created.visitId },
        { field: 'absenceFrom', old: null, new: payload.absenceFrom },
        { field: 'absenceTo', old: null, new: payload.absenceTo },
        { field: 'diagnosisSnapshot', old: null, new: snapshot },
      ],
    });

    return toDto(created);
  }

  async getById(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<VertetimDto> {
    this.requireDoctorOrAdmin(ctx);
    const row = await this.prisma.vertetim.findFirst({
      where: { id, clinicId },
    });
    if (!row) throw new NotFoundException('Vërtetimi nuk u gjet.');
    return toDto(row);
  }

  private requireDoctorOrAdmin(ctx: RequestContext): void {
    if (ctx.role === 'doctor' || ctx.role === 'clinic_admin') return;
    throw new ForbiddenException('Vetëm mjeku ka qasje në këtë veprim.');
  }
}

// ===========================================================================
// Pure helpers (exported for unit tests)
// ===========================================================================

interface VisitForSnapshot {
  legacyDiagnosis: string | null;
  diagnoses: Array<{ icd10Code: string; code: { latinDescription: string } }>;
}

/**
 * Build the immutable diagnosis text that lands on the vërtetim.
 *
 * Priority:
 *   1. Structured primary diagnosis  → "J03.9 — Tonsillitis acuta"
 *   2. Legacy free-text              → as-is
 *   3. Neither                       → "—"
 *
 * Once written, this string never changes — even if the doctor
 * edits the visit afterwards.
 */
export function buildDiagnosisSnapshot(visit: VisitForSnapshot): string {
  if (visit.diagnoses.length > 0) {
    const primary = visit.diagnoses[0]!;
    return `${primary.icd10Code} — ${primary.code.latinDescription}`;
  }
  if (visit.legacyDiagnosis && visit.legacyDiagnosis.trim().length > 0) {
    return visit.legacyDiagnosis.trim();
  }
  return '—';
}

export function daysInclusive(fromIso: string, toIso: string): number {
  const f = new Date(`${fromIso}T00:00:00Z`).getTime();
  const t = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.floor((t - f) / 86_400_000) + 1;
}

function toDto(row: {
  id: string;
  clinicId: string;
  patientId: string;
  visitId: string;
  issuedAt: Date;
  absenceFrom: Date;
  absenceTo: Date;
  diagnosisSnapshot: string;
}): VertetimDto {
  const from = row.absenceFrom.toISOString().slice(0, 10);
  const to = row.absenceTo.toISOString().slice(0, 10);
  return {
    id: row.id,
    clinicId: row.clinicId,
    patientId: row.patientId,
    visitId: row.visitId,
    issuedAt: row.issuedAt.toISOString(),
    absenceFrom: from,
    absenceTo: to,
    durationDays: daysInclusive(from, to),
    diagnosisSnapshot: row.diagnosisSnapshot,
  };
}
