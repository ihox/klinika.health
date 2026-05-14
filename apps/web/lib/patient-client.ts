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
  createdAt: string;
  updatedAt: string;
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
