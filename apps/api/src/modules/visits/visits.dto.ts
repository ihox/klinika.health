// Visit DTOs.
//
// Visits are the doctor's daily working surface — the entire form
// auto-saves into this shape. Receptionists never reach this module
// (the controller is `@Roles('doctor', 'clinic_admin')` only).
//
// Shape considerations:
//   * Every clinical field is optional on PATCH — the doctor fills the
//     visit in real time and most saves only touch a handful of fields.
//   * Body validation is forgiving (no minimum complaint length etc.)
//     but defensive on numerics: negative weight/height is rejected.
//   * Diagnoses ride alongside the regular form fields as an ordered
//     ICD-10 code array (slice 13). Order matters — index 0 is the
//     primary diagnosis by convention. The server rewrites the join
//     table (`visit_diagnoses`) on every PATCH that includes the key.
//
// The response uses `VisitDto` for everything (create, get, patch,
// restore). Soft delete returns `restorableUntil` and `status: 'ok'` —
// the same shape as the patient module so the web client's undo toast
// behavior is uniform across resource types.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Field validators
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data e pavlefshme')
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      return !Number.isNaN(d.getTime());
    },
    { message: 'Data e pavlefshme' },
  );

/**
 * Free-text clinical field. Up to 10 000 chars to fit a full
 * examination paragraph plus follow-up notes without burning through
 * the body limit on the auto-save path. Empty strings normalise to
 * undefined so they survive the PATCH shape without overwriting a
 * server-side value with "".
 */
const clinicalText = (max = 10_000) =>
  z
    .string()
    .max(max, 'Teksti është shumë i gjatë')
    .transform((v) => (v.trim().length === 0 ? null : v));

/** Grams: positive int, capped at 200 kg = 200_000 g. */
const optionalWeightGrams = z
  .number()
  .int()
  .min(0, 'Pesha nuk mund të jetë negative')
  .max(200_000, 'Pesha e pavlefshme')
  .nullable()
  .optional();

/** Centimetres: positive decimal, capped at 250 cm. */
const optionalHeightCm = z
  .number()
  .min(0, 'Gjatësia nuk mund të jetë negative')
  .max(250, 'Gjatësia e pavlefshme')
  .nullable()
  .optional();

/** Head circumference: positive decimal, capped at 80 cm. */
const optionalHeadCircumferenceCm = z
  .number()
  .min(0, 'Perimetri nuk mund të jetë negativ')
  .max(80, 'Perimetri i pavlefshëm')
  .nullable()
  .optional();

/** Temperature: 25–45 °C (clinical bounds; outside is almost certainly a typo). */
const optionalTemperatureC = z
  .number()
  .min(25, 'Temperatura e pavlefshme')
  .max(45, 'Temperatura e pavlefshme')
  .nullable()
  .optional();

const paymentCode = z.enum(['A', 'B', 'C', 'D', 'E']).nullable().optional();

const optionalBoolean = z.boolean().optional();
const optionalClinical = (max?: number) => clinicalText(max).nullable().optional();

/**
 * Ordered ICD-10 codes. Each entry is a catalogue key (regex
 * intentionally permissive — the foreign key validates membership).
 * Empty array clears the visit's diagnoses; omitting the key leaves
 * the join table untouched. Duplicates are rejected; the order the
 * doctor chose is the canonical primary-first sequence.
 */
const icd10CodeString = z
  .string()
  .min(1, 'Kod ICD-10 i pavlefshëm')
  .max(16, 'Kod ICD-10 i pavlefshëm')
  .regex(/^[A-Z][0-9]{2}(\.[0-9A-Z]{1,3})?$/, 'Kod ICD-10 i pavlefshëm');

const optionalDiagnoses = z
  .array(icd10CodeString)
  .max(20, 'Maksimumi 20 diagnoza për vizitë')
  .refine((arr) => new Set(arr).size === arr.length, {
    message: 'Diagnozat e dyfishuara nuk lejohen',
  })
  .optional();

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Minimal payload for "Vizitë e re" — the doctor clicks the button and
 * the server creates a row with today's date and the patient id. The
 * form then auto-saves into that row via PATCH.
 *
 * `visitDate` is accepted as a body field so backdating from the chart
 * shell stays possible, but the typical client omits it and the
 * service falls back to today (Europe/Belgrade calendar date).
 */
export const CreateVisitSchema = z
  .object({
    patientId: z.string().uuid('ID e pacientit e pavlefshme'),
    visitDate: isoDate.optional(),
  })
  .strict();

export type CreateVisitInput = z.infer<typeof CreateVisitSchema>;

// ---------------------------------------------------------------------------
// Update (PATCH — every field optional)
// ---------------------------------------------------------------------------

/**
 * Delta save payload. Only fields the user has touched ride the wire;
 * unspecified keys are left untouched server-side. `null` explicitly
 * clears a field; `undefined` is a no-op.
 */
export const UpdateVisitSchema = z
  .object({
    visitDate: isoDate.optional(),
    complaint: optionalClinical(10_000),
    feedingNotes: optionalClinical(2_000),
    feedingBreast: optionalBoolean,
    feedingFormula: optionalBoolean,
    feedingSolid: optionalBoolean,
    weightG: optionalWeightGrams,
    heightCm: optionalHeightCm,
    headCircumferenceCm: optionalHeadCircumferenceCm,
    temperatureC: optionalTemperatureC,
    paymentCode,
    examinations: optionalClinical(10_000),
    ultrasoundNotes: optionalClinical(10_000),
    legacyDiagnosis: optionalClinical(4_000),
    prescription: optionalClinical(10_000),
    labResults: optionalClinical(10_000),
    followupNotes: optionalClinical(4_000),
    otherNotes: optionalClinical(4_000),
    diagnoses: optionalDiagnoses,
  })
  .strict();

export type UpdateVisitInput = z.infer<typeof UpdateVisitSchema>;

// ---------------------------------------------------------------------------
// History query
// ---------------------------------------------------------------------------

export const VisitHistoryQuerySchema = z
  .object({
    limit: z
      .preprocess(
        (v) => (typeof v === 'string' ? Number(v) : v),
        z.number().int().min(1).max(200).optional(),
      )
      .transform((v) => v ?? 50),
  })
  .strict();

export type VisitHistoryQuery = z.infer<typeof VisitHistoryQuerySchema>;

// ---------------------------------------------------------------------------
// Soft-delete body — optional "Pse?" reason captured for the audit log
// ---------------------------------------------------------------------------
//
// The doctor's "Fshij vizitën" confirmation dialog ships an optional
// free-text reason (≤150 chars). Filled values are appended to the
// `visit.deleted` audit row as `{ field: 'deleteReason' }`. Empty /
// missing strings are silently dropped — the dialog is opt-in, not
// blocking, so we don't reject the request just because the doctor
// skipped the field.

export const DeleteVisitBodySchema = z
  .object({
    reason: z
      .string()
      .max(150, 'Arsyeja është shumë e gjatë (max 150)')
      .optional(),
  })
  .strict()
  .optional();

export type DeleteVisitBody = z.infer<typeof DeleteVisitBodySchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/**
 * Full visit record returned by all the visits endpoints. The web's
 * `visit-client.ts` mirrors this shape; keep them in sync.
 *
 * Decimal columns surface as numbers (Prisma's `Decimal` is stringified
 * server-side via {@link decimalToNumber}). `null` means "no value";
 * the web treats null and empty string interchangeably for textareas.
 */
export interface VisitDto {
  id: string;
  clinicId: string;
  patientId: string;
  visitDate: string;
  /**
   * Lifecycle status — one of the values in `VISIT_STATUSES`
   * ({@link ../visits-calendar.dto VISIT_STATUSES}). Surfaced on the
   * doctor's chart-form payload (Phase 2c) so the UI can gate
   * affordances like "Pastro vizitën" on `status === 'completed'`.
   */
  status: string;
  complaint: string | null;
  feedingNotes: string | null;
  feedingBreast: boolean;
  feedingFormula: boolean;
  feedingSolid: boolean;
  weightG: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  temperatureC: number | null;
  paymentCode: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  examinations: string | null;
  ultrasoundNotes: string | null;
  legacyDiagnosis: string | null;
  prescription: string | null;
  labResults: string | null;
  followupNotes: string | null;
  otherNotes: string | null;
  /**
   * Ordered ICD-10 diagnoses on the visit (primary first). Latin
   * descriptions are embedded so the chart can render chips without
   * a second round-trip. Empty array when no structured diagnoses
   * exist (the legacy free-text diagnosis lives on `legacyDiagnosis`).
   */
  diagnoses: VisitDiagnosisDto[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  /**
   * Whether the visit row has been touched since creation. The chart
   * UI shows the "Modifikuar nga …" line only when `wasUpdated` is
   * true. Computed server-side by comparing `updated_at - created_at`
   * against a 2-second skew window (the trigger writes both within
   * the same insert transaction).
   */
  wasUpdated: boolean;
}

export interface VisitDiagnosisDto {
  code: string;
  latinDescription: string;
  orderIndex: number;
}

/**
 * Result of `POST /api/visits/doctor-new`. Carries the visit DTO plus
 * an `existed` flag that tells the caller whether the server created
 * a new row (`false`) or routed them to a pre-existing active visit
 * for the same patient on the same day (`true`). The frontend uses
 * the flag to toast "Po hapet vizita ekzistuese" and skip the
 * fresh-creation animation. See ADR-013 Scenario C.
 */
export interface DoctorNewVisitResult {
  visit: VisitDto;
  existed: boolean;
}

export interface VisitHistoryEntryDto {
  id: string;
  /**
   * Audit-log action surfaced on the change-history modal. Includes
   * the legacy `visit.created` (pre-Slice G; pre-PR standalone rows)
   * and the post-Slice-G `visit.standalone.created` (ADR-013).
   */
  action:
    | 'visit.created'
    | 'visit.standalone.created'
    | 'visit.updated'
    | 'visit.deleted'
    | 'visit.restored';
  timestamp: string;
  userId: string;
  userDisplayName: string;
  userRole: 'doctor' | 'receptionist' | 'clinic_admin';
  ipAddress: string | null;
  changes: VisitHistoryFieldChange[] | null;
}

export interface VisitHistoryFieldChange {
  field: string;
  old: string | number | boolean | null;
  new: string | number | boolean | null;
}

// ---------------------------------------------------------------------------
// Row → DTO
// ---------------------------------------------------------------------------

export interface VisitRowLike {
  id: string;
  clinicId: string;
  patientId: string;
  visitDate: Date | string;
  status: string;
  complaint: string | null;
  feedingNotes: string | null;
  feedingBreast: boolean;
  feedingFormula: boolean;
  feedingSolid: boolean;
  weightG: number | null;
  heightCm: number | string | { toString(): string } | null;
  headCircumferenceCm: number | string | { toString(): string } | null;
  temperatureC: number | string | { toString(): string } | null;
  paymentCode: string | null;
  examinations: string | null;
  ultrasoundNotes: string | null;
  legacyDiagnosis: string | null;
  prescription: string | null;
  labResults: string | null;
  followupNotes: string | null;
  otherNotes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  createdBy: string;
  updatedBy: string;
  /**
   * Optional embedded diagnoses (with their Icd10Code relation). When
   * absent, the DTO falls back to an empty array — useful for older
   * code paths that haven't been updated to include the join.
   */
  diagnoses?: Array<{
    icd10Code: string;
    orderIndex: number;
    code?: { latinDescription: string } | null;
  }>;
}

const UPDATE_DETECTION_SKEW_MS = 2_000;

export function toVisitDto(row: VisitRowLike): VisitDto {
  const createdAt = toDate(row.createdAt);
  const updatedAt = toDate(row.updatedAt);
  return {
    id: row.id,
    clinicId: row.clinicId,
    patientId: row.patientId,
    visitDate: dateToIso(row.visitDate),
    status: row.status,
    complaint: row.complaint ?? null,
    feedingNotes: row.feedingNotes ?? null,
    feedingBreast: row.feedingBreast,
    feedingFormula: row.feedingFormula,
    feedingSolid: row.feedingSolid,
    weightG: row.weightG ?? null,
    heightCm: decimalToNumber(row.heightCm),
    headCircumferenceCm: decimalToNumber(row.headCircumferenceCm),
    temperatureC: decimalToNumber(row.temperatureC),
    paymentCode: normalisePaymentCode(row.paymentCode),
    examinations: row.examinations ?? null,
    ultrasoundNotes: row.ultrasoundNotes ?? null,
    legacyDiagnosis: row.legacyDiagnosis ?? null,
    prescription: row.prescription ?? null,
    labResults: row.labResults ?? null,
    followupNotes: row.followupNotes ?? null,
    otherNotes: row.otherNotes ?? null,
    diagnoses: toDiagnosisDtos(row.diagnoses),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    wasUpdated:
      updatedAt.getTime() - createdAt.getTime() > UPDATE_DETECTION_SKEW_MS,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

function dateToIso(value: Date | string): string {
  if (typeof value === 'string') {
    return value.slice(0, 10);
  }
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

function normalisePaymentCode(
  value: string | null,
): 'A' | 'B' | 'C' | 'D' | 'E' | null {
  if (value == null) return null;
  if (value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'E') {
    return value;
  }
  return null;
}

function toDiagnosisDtos(
  rows: VisitRowLike['diagnoses'],
): VisitDiagnosisDto[] {
  if (!rows || rows.length === 0) return [];
  return [...rows]
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((d) => ({
      code: d.icd10Code,
      latinDescription: d.code?.latinDescription ?? '',
      orderIndex: d.orderIndex,
    }));
}
