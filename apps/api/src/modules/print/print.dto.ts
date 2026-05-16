// Print module DTOs.
//
// The print surface (visit report, vërtetim, patient history) is
// purely server-rendered: every endpoint returns `application/pdf`.
// The DTOs below are the data shapes that flow from Postgres → the
// HTML templates → Puppeteer. They are not exported across the wire,
// so they live close to the rendering code rather than in a shared
// types package.
//
// All clinical text is rendered as-is (Albanian/Latin); the templates
// never invent strings. Internal-only fields (`alergjiTjera`,
// `complaint`, `feedingNotes`, `examinations`, `followupNotes`,
// `otherNotes`) are explicitly omitted from the print payloads — the
// canonical visibility table in CLAUDE.md / slice spec enforces this.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Patient history query
// ---------------------------------------------------------------------------
//
// `include_ultrasound` is the only knob the doctor toggles in the
// "Printo historinë" dialog. Defaults to `false` so a stray fetch
// doesn't accidentally embed 100+ image refs in the PDF.
//
// `.passthrough()` (not `.strict()`) so cache-buster params like `_t`
// — appended by the iframe-print harness in
// `apps/web/lib/print-frame.ts` to defeat the PDF cache — don't
// trip validation. The transform only emits the typed fields, so
// the controller can't accidentally lean on a stray query param.

export const HistoryPrintQuerySchema = z
  .object({
    include_ultrasound: z
      .preprocess(
        (v) => (typeof v === 'string' ? v.toLowerCase() : v),
        z.enum(['true', 'false']).optional(),
      )
      .transform((v) => v === 'true'),
  })
  .passthrough();

export type HistoryPrintQuery = z.infer<typeof HistoryPrintQuerySchema>;

// ---------------------------------------------------------------------------
// Template payloads — passed from the service to the template renderer.
// Keep these flat; the templates use Handlebars-style replacement on
// raw strings and don't walk deep object trees.
// ---------------------------------------------------------------------------

export interface ClinicLetterhead {
  formalName: string;
  shortName: string;
  address: string;
  city: string;
  phones: string[];
  hoursLine: string;
  /** "Lic. MSH-Nr. 1487-AM/24" — null hides the line. */
  licenseNumber: string | null;
}

export interface DoctorSignature {
  fullName: string;
  credential: string;
  /** Base64 data URI for the scanned signature image. Null = blank line. */
  signatureDataUri: string | null;
  /** "16.05.2026 · 14:32" — dd.MM.yyyy · HH:mm in Europe/Belgrade.
   *  Rendered in the footer's issue-block (left of the signature). */
  issuedAtDateTime: string;
  /** "Prizren" — clinic city. */
  issuedPlace: string;
}

export interface PatientHeaderForPrint {
  /** "Era Krasniqi" — never logged. */
  fullName: string;
  /** "vajzë · 2 vjeç 9 muaj" / "djalë · 4 muaj" / "5 ditë". Empty if no DOB/sex. */
  ageLine: string;
  /** ISO yyyy-mm-dd for the formatter. */
  dateOfBirth: string | null;
  /** "Prizren" — surfaced on the certificate body. */
  placeOfBirth: string | null;
  paymentCode: string | null;
  /** Legacy ID (`15626`) — shown next to the payment code letter. */
  legacyId: number | null;
  birthWeightG: number | null;
  birthLengthCm: number | null;
  birthHeadCircumferenceCm: number | null;
}

export interface VisitVitalsForPrint {
  /** Display as "13.6 kg" — already converted from grams. */
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  temperatureC: number | null;
}

export interface VisitDiagnosisForPrint {
  code: string;
  latinDescription: string;
  isPrimary: boolean;
}

export interface UltrasoundImageForPrint {
  index: number;
  caption: string;
  /**
   * Stable Orthanc-derived label rendered next to the image, e.g.
   * "DM-15626 / US ABD" + date. v1 renders an SVG placeholder when
   * no image data is shipped; the DICOM proxy ships base64 later.
   */
  metaLine: string;
}

export interface VisitReportTemplateData {
  clinic: ClinicLetterhead;
  patient: PatientHeaderForPrint;
  visitDate: string; // ISO yyyy-mm-dd
  visitNumber: number;
  totalVisits: number;
  visitTime: string | null; // "14:20" or null
  vitals: VisitVitalsForPrint;
  diagnoses: VisitDiagnosisForPrint[];
  legacyDiagnosis: string | null;
  prescription: string | null;
  ultrasoundNotes: string | null;
  ultrasoundImages: UltrasoundImageForPrint[];
  signature: DoctorSignature;
}

export interface VertetimTemplateData {
  clinic: ClinicLetterhead;
  patient: PatientHeaderForPrint;
  /** Patient sex, kept distinct from `patient.ageLine` so the subject
   *  identification block can show "Gjinia · Mosha" as discrete
   *  fields. */
  patientSex: 'm' | 'f' | null;
  /** "PT-04829" — the same patient identifier shown on the history
   *  printout, surfaced in the subject identification block. */
  patientIdLabel: string;
  diagnosis: VisitDiagnosisForPrint | null;
  /** Frozen at issue — never recomputed from the live visit. */
  diagnosisSnapshot: string;
  /** Full serial as it renders on paper: "VM-YYYY-NNNN". */
  certificateNumber: string;
  issuedAtIso: string;
  absenceFrom: string; // ISO yyyy-mm-dd
  absenceTo: string;
  durationDays: number;
  signature: DoctorSignature;
}

export interface HistoryVisitRow {
  visitDate: string; // ISO yyyy-mm-dd
  /** "HH:MM" in Europe/Belgrade, from visit.createdAt. Null when the
   *  legacy migration didn't carry a time. */
  visitTime: string | null;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  temperatureC: number | null;
  diagnoses: VisitDiagnosisForPrint[];
  legacyDiagnosis: string | null;
  prescription: string | null;
}

export interface GrowthSeriesPoint {
  visitDate: string; // ISO yyyy-mm-dd
  value: number;
}

export interface HistoryTemplateData {
  clinic: ClinicLetterhead;
  patient: PatientHeaderForPrint;
  /** Patient sex, kept distinct from `patient.ageLine` so the growth
   *  charts can tint the clinical line male/female (or fall back to
   *  the neutral teal when unknown). */
  patientSex: 'm' | 'f' | null;
  /** "PT-04829" — assembled from legacyId or UUID short form. */
  patientIdLabel: string;
  visits: HistoryVisitRow[];
  visitCount: number;
  visitDateRange: { from: string; to: string } | null;
  /** Latest weight + height + head circ for the right-header today
   *  measurements row. */
  todaySummary: {
    weightKg: number | null;
    heightCm: number | null;
    headCircumferenceCm: number | null;
  } | null;
  /** Per-metric time series — oldest-first so the chart x-axis goes
   *  left-to-right in chronological order. Only points where the
   *  measurement is non-null. */
  growthSeries: {
    weight: GrowthSeriesPoint[];
    height: GrowthSeriesPoint[];
    headCircumference: GrowthSeriesPoint[];
  };
  signature: DoctorSignature;
  includeUltrasound: boolean;
  ultrasoundAppendix: UltrasoundImageForPrint[];
}
