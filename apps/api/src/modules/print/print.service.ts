import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { hasClinicalAccess } from '../../common/request-context/role-helpers';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ageLine,
  formatCertificateNumber,
  formatIsoDateDdMmYyyy,
  formatPatientIdLabel,
  hoursLineFromConfig,
} from './print.format';
import type {
  ClinicLetterhead,
  DoctorSignature,
  HistoryTemplateData,
  HistoryVisitRow,
  PatientHeaderForPrint,
  VertetimTemplateData,
  VisitDiagnosisForPrint,
  VisitReportTemplateData,
} from './print.dto';
import { PrintRendererProxy } from './print-renderer.service';
import { renderHistory } from './templates/history.template';
import { renderVertetim } from './templates/vertetim.template';
import { renderVisitReport } from './templates/visit-report.template';

/**
 * Print pipeline orchestrator.
 *
 * Data flow per request:
 *   1. Load all required clinical rows (clinic + patient + visit /
 *      vërtetim / visit list) scoped by `clinicId`.
 *   2. Map them into the template data shapes — internal-only fields
 *      (allergies, complaint, examinations, follow-up notes) are
 *      simply not copied across, which is the canonical visibility
 *      enforcement.
 *   3. Render the HTML template, hand to the renderer for PDF.
 *   4. Write an audit row capturing who printed what.
 *
 * Doctor / clinic-admin only — receptionists 403 at the controller.
 * Service rechecks defensively.
 */
@Injectable()
export class PrintService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: PrintRendererProxy,
    private readonly audit: AuditLogService,
  ) {}

  // -------------------------------------------------------------------------
  // Visit report
  // -------------------------------------------------------------------------

  async renderVisitReportPdf(
    clinicId: string,
    visitId: string,
    ctx: RequestContext,
  ): Promise<Buffer> {
    this.requireDoctorOrAdmin(ctx);
    const visit = await this.prisma.visit.findFirst({
      where: { id: visitId, clinicId, deletedAt: null },
      include: {
        patient: true,
        diagnoses: { include: { code: true }, orderBy: { orderIndex: 'asc' } },
      },
    });
    if (!visit) throw new NotFoundException('Vizita nuk u gjet.');
    const [clinic, doctor, allVisitsCount] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } }),
      this.loadDoctor(ctx),
      this.prisma.visit.count({
        where: { clinicId, patientId: visit.patientId, deletedAt: null },
      }),
    ]);
    // Determine visit ordinal (1-based, oldest-first) for the
    // "Vizita N nga M" line on the report.
    const visitNumber = await this.prisma.visit.count({
      where: {
        clinicId,
        patientId: visit.patientId,
        deletedAt: null,
        OR: [
          { visitDate: { lt: visit.visitDate } },
          { visitDate: visit.visitDate, createdAt: { lte: visit.createdAt } },
        ],
      },
    });

    const data: VisitReportTemplateData = {
      clinic: clinicLetterhead(clinic),
      patient: patientHeader(visit.patient, visit.paymentCode),
      visitDate: dateToIso(visit.visitDate),
      visitNumber,
      totalVisits: allVisitsCount,
      visitTime: null,
      vitals: {
        weightKg: visit.weightG != null ? visit.weightG / 1000 : null,
        heightCm: decimalToNumber(visit.heightCm),
        headCircumferenceCm: decimalToNumber(visit.headCircumferenceCm),
        temperatureC: decimalToNumber(visit.temperatureC),
      },
      diagnoses: visit.diagnoses.map((d, idx) => ({
        code: d.icd10Code,
        latinDescription: d.code.latinDescription,
        isPrimary: idx === 0,
      })),
      legacyDiagnosis: visit.legacyDiagnosis,
      prescription: visit.prescription,
      ultrasoundNotes: visit.ultrasoundNotes,
      // Ultrasound study linkage lands in a later slice (DICOM); the
      // renderer treats an empty array as "no page 2 unless notes
      // populated". Future code populates this from `VisitDicomLink`.
      ultrasoundImages: [],
      signature: this.doctorSignature(clinic, doctor, new Date()),
    };

    const html = renderVisitReport(data);
    const pdf = await this.renderer.render(html, `visit:${visitId}`);

    await this.audit.record({
      ctx,
      action: 'print.visit_report.requested',
      resourceType: 'visit',
      resourceId: visitId,
      changes: null,
    });
    return pdf;
  }

  // -------------------------------------------------------------------------
  // Vërtetim
  // -------------------------------------------------------------------------

  async renderVertetimPdf(
    clinicId: string,
    vertetimId: string,
    ctx: RequestContext,
  ): Promise<Buffer> {
    this.requireDoctorOrAdmin(ctx);
    const cert = await this.prisma.vertetim.findFirst({
      where: { id: vertetimId, clinicId },
      include: {
        patient: true,
        visit: {
          include: {
            diagnoses: {
              include: { code: true },
              orderBy: { orderIndex: 'asc' },
              take: 1,
            },
          },
        },
        issuedByUser: true,
      },
    });
    if (!cert) throw new NotFoundException('Vërtetimi nuk u gjet.');
    const clinic = await this.prisma.clinic.findUniqueOrThrow({
      where: { id: clinicId },
    });
    const sequence = await this.computeVertetimSequence(clinicId, cert.issuedAt);

    // Diagnosis on the certificate is the snapshot first, with the
    // current visit's primary diagnosis as a structured fallback for
    // formatting (code + description). Reprints always show the
    // snapshot text — even if the doctor later edits the visit.
    const primaryDx = cert.visit.diagnoses[0];
    const diagnosis: VisitDiagnosisForPrint | null = primaryDx
      ? {
          code: primaryDx.icd10Code,
          latinDescription: primaryDx.code.latinDescription,
          isPrimary: true,
        }
      : null;

    const data: VertetimTemplateData = {
      clinic: clinicLetterhead(clinic),
      patient: patientHeader(cert.patient, null),
      diagnosis,
      diagnosisSnapshot: cert.diagnosisSnapshot,
      certificateNumber: formatCertificateNumber(cert.issuedAt, sequence),
      issuedAtIso: cert.issuedAt.toISOString(),
      absenceFrom: dateToIso(cert.absenceFrom),
      absenceTo: dateToIso(cert.absenceTo),
      durationDays: daysInclusive(cert.absenceFrom, cert.absenceTo),
      signature: this.doctorSignatureFromUser(
        clinic,
        {
          firstName: cert.issuedByUser.firstName,
          lastName: cert.issuedByUser.lastName,
          title: cert.issuedByUser.title,
          credential: cert.issuedByUser.credential,
          signatureUrl: cert.issuedByUser.signatureUrl,
        },
        cert.issuedAt,
      ),
    };

    const html = renderVertetim(data);
    const pdf = await this.renderer.render(html, `vertetim:${vertetimId}`);

    await this.audit.record({
      ctx,
      action: 'print.vertetim.requested',
      resourceType: 'vertetim',
      resourceId: vertetimId,
      changes: null,
    });
    return pdf;
  }

  // -------------------------------------------------------------------------
  // Patient history
  // -------------------------------------------------------------------------

  async renderHistoryPdf(
    clinicId: string,
    patientId: string,
    includeUltrasound: boolean,
    ctx: RequestContext,
  ): Promise<Buffer> {
    this.requireDoctorOrAdmin(ctx);
    const patient = await this.prisma.patient.findFirst({
      where: { id: patientId, clinicId, deletedAt: null },
    });
    if (!patient) throw new NotFoundException('Pacienti nuk u gjet.');

    const [clinic, doctor, visits] = await Promise.all([
      this.prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } }),
      this.loadDoctor(ctx),
      this.prisma.visit.findMany({
        where: { clinicId, patientId, deletedAt: null },
        orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          diagnoses: {
            include: { code: true },
            orderBy: { orderIndex: 'asc' },
          },
        },
      }),
    ]);

    const visitRows: HistoryVisitRow[] = visits.map((v) => ({
      visitDate: dateToIso(v.visitDate),
      weightKg: v.weightG != null ? v.weightG / 1000 : null,
      diagnoses: v.diagnoses.map((d, idx) => ({
        code: d.icd10Code,
        latinDescription: d.code.latinDescription,
        isPrimary: idx === 0,
      })),
      legacyDiagnosis: v.legacyDiagnosis,
      prescription: v.prescription,
    }));

    // Today summary = most recent visit's weight + height, used in
    // the master block. `visits` is already sorted newest-first.
    const latest = visits[0];
    const todaySummary = latest
      ? {
          weightKg: latest.weightG != null ? latest.weightG / 1000 : null,
          heightCm: decimalToNumber(latest.heightCm),
        }
      : null;

    const dateRange =
      visits.length > 0
        ? {
            from: dateToIso(visits[visits.length - 1]!.visitDate),
            to: dateToIso(visits[0]!.visitDate),
          }
        : null;

    const data: HistoryTemplateData = {
      clinic: clinicLetterhead(clinic),
      patient: patientHeader(patient, null),
      patientIdLabel: formatPatientIdLabel(patient.legacyId, patient.id),
      visits: visitRows,
      visitCount: visits.length,
      visitDateRange: dateRange,
      todaySummary,
      signature: this.doctorSignature(clinic, doctor, new Date()),
      includeUltrasound,
      // Ultrasound appendix wiring lands in the DICOM slice; for v1
      // we emit an empty appendix even when requested, so the
      // checkbox doesn't crash the renderer.
      ultrasoundAppendix: [],
    };

    const html = renderHistory(data);
    const pdf = await this.renderer.render(html, `history:${patientId}`);

    await this.audit.record({
      ctx,
      action: 'print.history.requested',
      resourceType: 'patient',
      resourceId: patientId,
      changes: null,
    });
    return pdf;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private requireDoctorOrAdmin(ctx: RequestContext): void {
    if (hasClinicalAccess(ctx.roles)) return;
    throw new ForbiddenException('Vetëm mjeku ka qasje në këtë veprim.');
  }

  private async loadDoctor(ctx: RequestContext): Promise<{
    firstName: string;
    lastName: string;
    title: string | null;
    credential: string | null;
    signatureUrl: string | null;
  }> {
    if (!ctx.userId) {
      throw new ForbiddenException('Sesioni i pavlefshëm.');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { firstName: true, lastName: true, title: true, credential: true, signatureUrl: true },
    });
    if (!user) throw new ForbiddenException('Sesioni i pavlefshëm.');
    return user;
  }

  private doctorSignature(
    clinic: { city: string; shortName: string },
    user: {
      firstName: string;
      lastName: string;
      title: string | null;
      credential: string | null;
      signatureUrl: string | null;
    },
    at: Date,
  ): DoctorSignature {
    return this.doctorSignatureFromUser(clinic, user, at);
  }

  private doctorSignatureFromUser(
    clinic: { city: string; shortName: string },
    user: {
      firstName: string;
      lastName: string;
      title: string | null;
      credential: string | null;
      signatureUrl: string | null;
    },
    at: Date,
  ): DoctorSignature {
    const title = user.title?.trim() || 'Dr.';
    const fullName = `${title} ${user.firstName} ${user.lastName}`;
    const credential = `${user.credential ?? 'pediatër'} · ${clinic.shortName}`;
    // Belgrade calendar date for the issued-at line on the footer.
    const dateIso = formatBelgradeDateIso(at);
    return {
      fullName,
      credential,
      // The signature image URL is a clinic-served path; templates
      // accept null and render the placeholder svg. Embedding the
      // image as a data URI happens at render time once we wire the
      // signature-upload pipeline; for now we always pass null so the
      // template prints a blank line + handwritten signature space.
      signatureDataUri: null,
      dateAndPlace: `${formatIsoDateDdMmYyyy(dateIso)} · ${clinic.city}`,
    };
  }

  private async computeVertetimSequence(
    clinicId: string,
    issuedAt: Date,
  ): Promise<number> {
    // "Nr. 2026-NNNN" — sequence within the calendar year, anchored
    // to UTC for stability. Reprints recompute and get the same
    // number (the order is `issued_at` ASC + `id` ASC for a stable
    // tiebreaker).
    const year = issuedAt.getUTCFullYear();
    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
    const earlier = await this.prisma.vertetim.count({
      where: {
        clinicId,
        issuedAt: { gte: yearStart, lt: yearEnd, lte: issuedAt },
      },
    });
    return Math.max(1, earlier);
  }
}

// ===========================================================================
// Pure helpers (exported for unit tests)
// ===========================================================================

export function clinicLetterhead(clinic: {
  name: string;
  shortName: string;
  address: string;
  city: string;
  phones: string[];
  hoursConfig: unknown;
}): ClinicLetterhead {
  return {
    formalName: clinic.name,
    shortName: clinic.shortName,
    address: clinic.address,
    city: clinic.city,
    phones: clinic.phones,
    hoursLine: hoursLineFromConfig(clinic.hoursConfig),
  };
}

export function patientHeader(
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: Date | null;
    placeOfBirth: string | null;
    sex: 'm' | 'f' | null;
    legacyId: number | null;
    birthWeightG: number | null;
    birthLengthCm: { toString(): string } | number | null;
    birthHeadCircumferenceCm: { toString(): string } | number | null;
  },
  paymentCode: string | null,
  asOf: Date = new Date(),
): PatientHeaderForPrint {
  const dobIso = patient.dateOfBirth ? dateToIso(patient.dateOfBirth) : null;
  return {
    fullName: `${patient.firstName} ${patient.lastName}`,
    ageLine: ageLine(dobIso, patient.sex, formatBelgradeDateIso(asOf)),
    dateOfBirth: dobIso,
    placeOfBirth: patient.placeOfBirth,
    paymentCode,
    legacyId: patient.legacyId,
    birthWeightG: patient.birthWeightG,
    birthLengthCm: decimalToNumber(patient.birthLengthCm),
    birthHeadCircumferenceCm: decimalToNumber(patient.birthHeadCircumferenceCm),
  };
}

function dateToIso(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function decimalToNumber(
  value: number | string | { toString(): string } | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const n = Number(typeof value === 'string' ? value : value.toString());
  return Number.isFinite(n) ? n : null;
}

function daysInclusive(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toUtc = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((toUtc - fromUtc) / 86_400_000) + 1;
}

function formatBelgradeDateIso(d: Date): string {
  // Stable ISO date string in Europe/Belgrade locale, regardless of
  // host timezone — Sweden's date locale gives yyyy-mm-dd output.
  return d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Belgrade' });
}
