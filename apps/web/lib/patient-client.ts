import { apiFetch } from './api';

// ---------------------------------------------------------------------------
// Wire shapes — keep aligned with
//   apps/api/src/modules/patients/patients.dto.ts
//
// Two response shapes: PatientPublicDto (receptionist) and
// PatientFullDto (doctor / clinic admin). The receptionist UI never
// imports PatientFullDto from this file directly — the type discipline
// reinforces the runtime DTO discipline at the API.
// ---------------------------------------------------------------------------

export interface PatientPublicDto {
  id: string;
  firstName: string;
  lastName: string;
  /** ISO yyyy-mm-dd, or null when not yet captured. */
  dateOfBirth: string | null;
  /** ISO yyyy-mm-dd of the patient's most recent completed visit, or
   *  null when they have none. Drives the recency dot in search rows. */
  lastVisitAt: string | null;
}

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
  lastVisitAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * True when firstName, lastName, dateOfBirth, and sex are all
   * populated. Drives conditional navigation — doctor jumps straight
   * to the chart when complete, or to the master-data form when not.
   * Computed server-side; mirrored by `isPatientComplete` in
   * `apps/web/lib/patient.ts` for client-side checks on form drafts.
   */
  isComplete: boolean;
}

export interface DoctorPatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex?: 'm' | 'f';
  placeOfBirth?: string;
  phone?: string;
  birthWeightG?: number;
  birthLengthCm?: number;
  birthHeadCircumferenceCm?: number;
  alergjiTjera?: string;
}

export interface DoctorPatientUpdate extends Partial<DoctorPatientInput> {}

export interface ReceptionistPatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
}

export interface DuplicateCheckResponse {
  candidates: PatientPublicDto[];
}

export interface SoftDeleteResponse {
  status: 'ok';
  restorableUntil: string;
}

// ---------------------------------------------------------------------------
// Chart bundle — keep aligned with apps/api/src/modules/patients/
// patient-chart.dto.ts
// ---------------------------------------------------------------------------

export interface ChartVisitDto {
  id: string;
  visitDate: string;
  primaryDiagnosis: {
    code: string;
    latinDescription: string;
  } | null;
  legacyDiagnosis: string | null;
  paymentCode: string | null;
  updatedAt: string;
}

export interface ChartVertetimDto {
  id: string;
  visitId: string;
  issuedAt: string;
  absenceFrom: string;
  absenceTo: string;
  durationDays: number;
  diagnosisSnapshot: string;
}

export interface ChartGrowthPointDto {
  visitId: string;
  /** ISO yyyy-mm-dd of the visit (or visit creation date as fallback). */
  visitDate: string;
  /** Patient's age at the visit in whole months. Drives the WHO chart x-axis. */
  ageMonths: number;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
}

export interface PatientChartDto {
  patient: PatientFullDto;
  visits: ChartVisitDto[];
  vertetime: ChartVertetimDto[];
  daysSinceLastVisit: number | null;
  visitCount: number;
  /** Growth-chart points, oldest first. Empty when no measurements recorded. */
  growthPoints: ChartGrowthPointDto[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const patientClient = {
  // Receptionist & doctor both call this — server returns the role-
  // appropriate DTO shape automatically. Callers must declare which
  // shape they expect.
  searchPublic: (q: string, limit?: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (limit !== undefined) params.set('limit', String(limit));
    return apiFetch<{ patients: PatientPublicDto[] }>(
      `/api/patients${params.toString() ? `?${params.toString()}` : ''}`,
    );
  },

  searchFull: (q: string, limit?: number) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (limit !== undefined) params.set('limit', String(limit));
    return apiFetch<{ patients: PatientFullDto[] }>(
      `/api/patients${params.toString() ? `?${params.toString()}` : ''}`,
    );
  },

  duplicateCheck: (input: ReceptionistPatientInput) =>
    apiFetch<DuplicateCheckResponse>('/api/patients/duplicate-check', {
      method: 'POST',
      json: input,
    }),

  createMinimal: (input: ReceptionistPatientInput) =>
    apiFetch<{ patient: PatientPublicDto }>('/api/patients', {
      method: 'POST',
      json: input,
    }),

  createFull: (input: DoctorPatientInput) =>
    apiFetch<{ patient: PatientFullDto }>('/api/patients', {
      method: 'POST',
      json: input,
    }),

  getOne: (id: string) =>
    apiFetch<{ patient: PatientFullDto }>(`/api/patients/${id}`),

  getChart: (id: string) => apiFetch<PatientChartDto>(`/api/patients/${id}/chart`),

  update: (id: string, input: DoctorPatientUpdate) =>
    apiFetch<{ patient: PatientFullDto }>(`/api/patients/${id}`, {
      method: 'PATCH',
      json: input,
    }),

  softDelete: (id: string) =>
    apiFetch<SoftDeleteResponse>(`/api/patients/${id}`, { method: 'DELETE' }),

  restore: (id: string) =>
    apiFetch<{ patient: PatientFullDto }>(`/api/patients/${id}/restore`, {
      method: 'POST',
    }),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO date as DD.MM.YYYY in the Albanian locale.
 * Returns "—" when null (the receptionist may not have captured a DOB
 * yet at quick-add time).
 */
export function formatDob(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '—';
  return `${d}.${m}.${y}`;
}

/**
 * Render an age band like "2v 3m" / "4 muaj" / "12 ditë". Always
 * computes in the Europe/Belgrade view but UTC-safe at the day
 * boundary because we use simple YYYY-MM-DD arithmetic.
 */
export function ageLabel(dobIso: string | null, asOf: Date = new Date()): string {
  if (!dobIso) return '';
  const dob = new Date(`${dobIso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return '';
  const days = Math.floor((asOf.getTime() - dob.getTime()) / 86_400_000);
  if (days < 0) return '';
  if (days < 60) return `${days} ditë`;
  const months =
    (asOf.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - dob.getUTCMonth()) -
    (asOf.getUTCDate() < dob.getUTCDate() ? 1 : 0);
  if (months < 24) return `${months} muaj`;
  const years = Math.floor(months / 12);
  const remMonths = months - years * 12;
  if (remMonths === 0) return `${years}v`;
  return `${years}v ${remMonths}m`;
}

export function patientInitials(p: { firstName: string; lastName: string }): string {
  const f = p.firstName.trim()[0] ?? '';
  const l = p.lastName.trim()[0] ?? '';
  return `${f}${l}`.toUpperCase();
}

/**
 * Compact age band for the chart master strip: "2v 3m" / "11m" /
 * "1v" / "12 ditë". Differs from {@link ageLabel} by using the
 * one-letter suffixes "v"/"m" instead of "muaj" — the chart strip
 * is dense and the prototype renders it this way.
 *
 * Returns an empty string when the DOB is null (receptionist
 * quick-add patients without a captured DOB).
 */
export function ageLabelChart(dobIso: string | null, asOf: Date = new Date()): string {
  if (!dobIso) return '';
  const dob = new Date(`${dobIso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return '';
  const days = Math.floor((asOf.getTime() - dob.getTime()) / 86_400_000);
  if (days < 0) return '';
  if (days < 60) return `${days} ditë`;
  const months =
    (asOf.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - dob.getUTCMonth()) -
    (asOf.getUTCDate() < dob.getUTCDate() ? 1 : 0);
  if (months < 12) return `${months}m`;
  const years = Math.floor(months / 12);
  const remMonths = months - years * 12;
  if (remMonths === 0) return `${years}v`;
  return `${years}v ${remMonths}m`;
}

export type DaysSinceVisitColor = 'red' | 'amber' | 'green';

/**
 * Map "days since last visit" to one of three indicator colors per
 * the chart master strip spec.
 *
 *   1–7     → red    (very recent — likely a follow-up)
 *   8–30    → amber  (within the month)
 *   > 30    → green
 *   0/null  → green  (today or no prior visit at all)
 *
 * Mirrors `apps/api/src/modules/patients/patient-chart.format.ts`
 * — keep them in sync.
 */
export function daysSinceVisitColor(days: number | null): DaysSinceVisitColor {
  if (days == null || days <= 0) return 'green';
  if (days <= 7) return 'red';
  if (days <= 30) return 'amber';
  return 'green';
}
