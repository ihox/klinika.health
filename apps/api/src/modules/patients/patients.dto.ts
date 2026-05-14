// Patient DTOs.
//
// Two response shapes coexist in this module — and the distinction is
// load-bearing for CLAUDE.md §1.2 (the receptionist privacy boundary):
//
//   * `PatientPublicDto`  — what the receptionist may see (id + name +
//                           date of birth, nothing else).
//   * `PatientFullDto`    — the doctor's full record, every master-data
//                           field.
//
// All controllers MUST `toPublicDto()` before responding to a request
// whose role is `receptionist`. The function strips every field that
// isn't on the public shape, even if the database row has them.
// `toPublicDto()` and `toFullDto()` are the single chokepoint — both
// the controllers and the search service flow through them. See the
// `PatientPublicDto serialization` unit tests (`patients.dto.spec.ts`)
// for the property-style proofs that no PHI leaks regardless of input
// shape.
//
// Request bodies for create/update are also role-scoped:
//   * Receptionist quick-add accepts only `firstName`, `lastName`,
//     `dateOfBirth?` — every other property posted by a tampered client
//     is silently dropped by Zod's default `.strip()` (matching the
//     slice spec "fields silently dropped, not stored"). The service
//     also writes only those three columns regardless, so the DB
//     stays clean even if the schema ever loosens.
//   * Doctor full-data requests use a `.strict()` schema with all
//     master fields — extra keys 400, catching UI bugs early in a
//     role where any column may legitimately be set.
//
// Schema validation is via Zod (no class-validator anywhere — see
// docs/architecture.md). Response types are interfaces so the wire
// shape is stable even if database columns shift.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Common field helpers
// ---------------------------------------------------------------------------

const trimmedName = (label: string, max = 80) =>
  z
    .string()
    .trim()
    .min(1, `${label} mungon`)
    .max(max, `${label} është shumë i gjatë`);

// ISO yyyy-mm-dd; refuse future dates and impossibly old dates.
const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datelindja duhet të jetë në formatin VVVV-MM-DD')
  .refine(
    (s) => {
      const d = new Date(`${s}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return false;
      const now = new Date();
      if (d.getTime() > now.getTime()) return false;
      // Cap at 130 years old — defensive sanity check.
      const minYear = now.getUTCFullYear() - 130;
      return d.getUTCFullYear() >= minYear;
    },
    { message: 'Datelindja e pavlefshme' },
  );

const optionalString = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalPhone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[+0-9 ()\-./]*$/, 'Telefoni i pavlefshëm')
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined));

const optionalPositiveInt = z
  .number()
  .int()
  .positive()
  .max(20_000)
  .optional();

const optionalPositiveDecimal = z
  .number()
  .positive()
  .max(999.99)
  .optional();

const optionalText = (max = 1000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined));

// ---------------------------------------------------------------------------
// Receptionist quick-add request
// ---------------------------------------------------------------------------

/**
 * Body accepted from a receptionist creating a new patient. Zod's
 * default `.strip()` mode silently drops any extra keys (phone,
 * alergjiTjera, birthWeightG, etc.) — they never reach the service
 * layer, so even a tampered client can't write them. This matches the
 * slice spec literally ("fields silently dropped, not stored") and
 * keeps the receptionist's UX clean: legitimate clients still see 201.
 *
 * Defense-in-depth: the service also writes only the three permitted
 * columns explicitly, so removing `.strip()` would still leave the
 * DB untouched.
 */
export const ReceptionistCreatePatientSchema = z.object({
  firstName: trimmedName('Emri'),
  lastName: trimmedName('Mbiemri'),
  dateOfBirth: dateOfBirth.optional(),
});

export type ReceptionistCreatePatientInput = z.infer<typeof ReceptionistCreatePatientSchema>;

// ---------------------------------------------------------------------------
// Doctor full create/update request
// ---------------------------------------------------------------------------

/**
 * Full patient master data. Used for both create (doctor) and update.
 * `legacyId` is read-only (assigned by the Access migration tool) and
 * cannot be set via this API.
 */
export const DoctorCreatePatientSchema = z
  .object({
    firstName: trimmedName('Emri'),
    lastName: trimmedName('Mbiemri'),
    dateOfBirth: dateOfBirth,
    sex: z.enum(['m', 'f']).optional(),
    placeOfBirth: optionalString(120),
    phone: optionalPhone,
    birthWeightG: optionalPositiveInt,
    birthLengthCm: optionalPositiveDecimal,
    birthHeadCircumferenceCm: optionalPositiveDecimal,
    alergjiTjera: optionalText(2000),
  })
  .strict();

export type DoctorCreatePatientInput = z.infer<typeof DoctorCreatePatientSchema>;

/** Same shape as the create schema; every field is independently optional on PATCH. */
export const DoctorUpdatePatientSchema = DoctorCreatePatientSchema.partial();

export type DoctorUpdatePatientInput = z.infer<typeof DoctorUpdatePatientSchema>;

// ---------------------------------------------------------------------------
// Search query
// ---------------------------------------------------------------------------

export const PatientSearchQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    limit: z
      .preprocess(
        (v) => (typeof v === 'string' ? Number(v) : v),
        z.number().int().min(1).max(20).optional(),
      )
      .transform((v) => v ?? 10),
  })
  .strict();

export type PatientSearchQuery = z.infer<typeof PatientSearchQuerySchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/**
 * The receptionist's view: just enough to identify the patient when
 * booking an appointment. Adding any field here is a privacy
 * regression — see CLAUDE.md §1.2 and ADR-005.
 */
export interface PatientPublicDto {
  id: string;
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd, or null when not yet captured (quick-add). */
  dateOfBirth: string | null;
}

/**
 * The doctor's view: full master-data record. Sensitive fields like
 * `alergjiTjera` are present here but MUST never appear in the public
 * DTO regardless of role.
 */
export interface PatientFullDto {
  id: string;
  clinicId: string;
  legacyId: number | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  sex: 'm' | 'f' | null;
  placeOfBirth: string | null;
  phone: string | null;
  birthWeightG: number | null;
  birthLengthCm: number | null;
  birthHeadCircumferenceCm: number | null;
  alergjiTjera: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Row → DTO converters
// ---------------------------------------------------------------------------
//
// These are the SINGLE chokepoint for serialisation. The controllers
// call `toPublicDto`/`toFullDto` and never spread Prisma rows into the
// response. If a future column is added to `patients` it will not leak
// into the receptionist's response unless someone explicitly extends
// `PatientPublicDto` AND `toPublicDto` AND updates the unit test that
// proves no extra keys ever come back.

/**
 * Shape of the columns we need from the patient row. We accept `any`
 * extra keys defensively — `toPublicDto` only reads the four keys it
 * cares about, so unknown columns can't leak even if the caller hands
 * a fully-populated Prisma object.
 */
export interface PatientRowLike {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | string | null;
  // any other fields are tolerated but never read here
  [extra: string]: unknown;
}

export function toPublicDto(row: PatientRowLike): PatientPublicDto {
  // Explicit field-by-field construction — never `{...row}`. This is
  // the receptionist privacy boundary; spreading would defeat the
  // entire purpose of the DTO split.
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: dateToIso(row.dateOfBirth),
  };
}

export interface PatientFullRowLike extends PatientRowLike {
  clinicId: string;
  legacyId?: number | null;
  sex?: 'm' | 'f' | null;
  placeOfBirth?: string | null;
  phone?: string | null;
  birthWeightG?: number | null;
  // Prisma `Decimal` columns surface as a class instance whose
  // `toString()` returns the numeric value; accept that plus the
  // string/number variants from raw queries.
  birthLengthCm?: number | string | { toString(): string } | null;
  birthHeadCircumferenceCm?: number | string | { toString(): string } | null;
  alergjiTjera?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export function toFullDto(row: PatientFullRowLike): PatientFullDto {
  return {
    id: row.id,
    clinicId: row.clinicId,
    legacyId: row.legacyId ?? null,
    firstName: row.firstName,
    lastName: row.lastName,
    dateOfBirth: dateToIso(row.dateOfBirth),
    sex: row.sex ?? null,
    placeOfBirth: row.placeOfBirth ?? null,
    phone: row.phone ?? null,
    birthWeightG: row.birthWeightG ?? null,
    birthLengthCm: decimalToNumber(row.birthLengthCm),
    birthHeadCircumferenceCm: decimalToNumber(row.birthHeadCircumferenceCm),
    alergjiTjera: row.alergjiTjera ?? null,
    createdAt: timestampToIso(row.createdAt),
    updatedAt: timestampToIso(row.updatedAt),
  };
}

// Receptionist quick-add stores `UNKNOWN_DOB_SENTINEL` (1900-01-01)
// when no DOB is captured — see `patients.service.ts`. The DTO maps
// it back to null so the UI shows "DL pa caktuar" instead of a fake
// date.
const UNKNOWN_DOB_ISO = '1900-01-01';

function dateToIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  let iso: string;
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      iso = value.slice(0, 10);
    } else {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;
      iso = parsed.toISOString().slice(0, 10);
    }
  } else {
    iso = value.toISOString().slice(0, 10);
  }
  return iso === UNKNOWN_DOB_ISO ? null : iso;
}

function timestampToIso(value: Date | string): string {
  if (typeof value === 'string') return value;
  return value.toISOString();
}

function decimalToNumber(
  value: number | string | { toString(): string } | null | undefined,
): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const n = Number(typeof value === 'string' ? value : value.toString());
  return Number.isFinite(n) ? n : null;
}
