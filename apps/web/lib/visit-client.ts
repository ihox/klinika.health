import { apiFetch } from './api';

// ---------------------------------------------------------------------------
// Wire shapes — keep aligned with
//   apps/api/src/modules/visits/visits.dto.ts
// ---------------------------------------------------------------------------

export type PaymentCode = 'A' | 'B' | 'C' | 'D' | 'E';

export interface VisitDiagnosisDto {
  code: string;
  latinDescription: string;
  orderIndex: number;
}

export interface VisitDto {
  id: string;
  clinicId: string;
  patientId: string;
  visitDate: string;
  complaint: string | null;
  feedingNotes: string | null;
  feedingBreast: boolean;
  feedingFormula: boolean;
  feedingSolid: boolean;
  weightG: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
  temperatureC: number | null;
  paymentCode: PaymentCode | null;
  examinations: string | null;
  ultrasoundNotes: string | null;
  legacyDiagnosis: string | null;
  prescription: string | null;
  labResults: string | null;
  followupNotes: string | null;
  otherNotes: string | null;
  diagnoses: VisitDiagnosisDto[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  wasUpdated: boolean;
}

/** PATCH payload — every field optional, only changed ones sent. */
export interface UpdateVisitInput {
  visitDate?: string;
  complaint?: string | null;
  feedingNotes?: string | null;
  feedingBreast?: boolean;
  feedingFormula?: boolean;
  feedingSolid?: boolean;
  weightG?: number | null;
  heightCm?: number | null;
  headCircumferenceCm?: number | null;
  temperatureC?: number | null;
  paymentCode?: PaymentCode | null;
  examinations?: string | null;
  ultrasoundNotes?: string | null;
  legacyDiagnosis?: string | null;
  prescription?: string | null;
  labResults?: string | null;
  followupNotes?: string | null;
  otherNotes?: string | null;
  /**
   * Ordered ICD-10 codes (primary first). Omit to leave the join
   * table untouched; send an empty array to clear all diagnoses.
   */
  diagnoses?: string[];
}

export interface VisitHistoryFieldChange {
  field: string;
  old: string | number | boolean | null;
  new: string | number | boolean | null;
}

export interface VisitHistoryEntryDto {
  id: string;
  action: 'visit.created' | 'visit.updated' | 'visit.deleted' | 'visit.restored';
  timestamp: string;
  userId: string;
  userDisplayName: string;
  userRole: 'doctor' | 'receptionist' | 'clinic_admin';
  ipAddress: string | null;
  changes: VisitHistoryFieldChange[] | null;
}

export interface SoftDeleteResponse {
  status: 'ok';
  restorableUntil: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const visitClient = {
  /**
   * Doctor's "Vizitë e re" — POSTs to /api/visits/doctor-new, which
   * auto-pairs the new row to today's in-progress booking when one
   * is available (sibling / companion arrives without a booking) and
   * otherwise falls through to a calendar-invisible chart entry. The
   * caller doesn't need to know which path the server took; the
   * returned VisitDto is the same shape either way.
   */
  create: (patientId: string, visitDate?: string) =>
    apiFetch<{ visit: VisitDto }>('/api/visits/doctor-new', {
      method: 'POST',
      json: visitDate ? { patientId, visitDate } : { patientId },
    }),

  getOne: (id: string) => apiFetch<{ visit: VisitDto }>(`/api/visits/${id}`),

  update: (id: string, input: UpdateVisitInput) =>
    apiFetch<{ visit: VisitDto }>(`/api/visits/${id}`, {
      method: 'PATCH',
      json: input,
    }),

  /**
   * keepalive-friendly PATCH used by `beforeunload`. Browsers throttle
   * regular fetch on unload — `keepalive: true` plus a small body
   * raises the bar enough for the auto-save to still land server-side
   * for typical visit deltas (well under the 64KB keepalive cap).
   */
  updateBeforeUnload: (id: string, input: UpdateVisitInput): void => {
    if (typeof fetch === 'undefined') return;
    const body = JSON.stringify(input);
    try {
      // No await — we're firing on unload; the network task carries on
      // after the page is gone thanks to `keepalive`.
      void fetch(`/api/visits/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        keepalive: true,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
      });
    } catch {
      // Best-effort by design — surface IndexedDB has the data anyway.
    }
  },

  softDelete: (id: string) =>
    apiFetch<SoftDeleteResponse>(`/api/visits/${id}`, { method: 'DELETE' }),

  restore: (id: string) =>
    apiFetch<{ visit: VisitDto }>(`/api/visits/${id}/restore`, {
      method: 'POST',
    }),

  history: (id: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : '';
    return apiFetch<{ entries: VisitHistoryEntryDto[] }>(
      `/api/visits/${id}/history${qs}`,
    );
  },
};

// ---------------------------------------------------------------------------
// UI-facing helpers — purely client-side
// ---------------------------------------------------------------------------

/**
 * Form state mirrors the wire shape but normalises numbers as the
 * empty string when unset so the inputs render uncontrolled cleanly.
 */
export interface VisitFormValues {
  visitDate: string;
  complaint: string;
  feedingNotes: string;
  feedingBreast: boolean;
  feedingFormula: boolean;
  feedingSolid: boolean;
  weightKg: string;
  heightCm: string;
  headCircumferenceCm: string;
  temperatureC: string;
  paymentCode: PaymentCode | '';
  examinations: string;
  ultrasoundNotes: string;
  legacyDiagnosis: string;
  prescription: string;
  labResults: string;
  followupNotes: string;
  otherNotes: string;
  /**
   * Ordered ICD-10 chips. Index 0 is the primary diagnosis. The list is
   * the source of truth for the picker — re-ordering, adding, and
   * removing a chip all mutate this array.
   */
  diagnoses: VisitDiagnosisDto[];
}

export function visitToFormValues(v: VisitDto): VisitFormValues {
  return {
    visitDate: v.visitDate,
    complaint: v.complaint ?? '',
    feedingNotes: v.feedingNotes ?? '',
    feedingBreast: v.feedingBreast,
    feedingFormula: v.feedingFormula,
    feedingSolid: v.feedingSolid,
    weightKg: v.weightG == null ? '' : (v.weightG / 1000).toFixed(2).replace(/\.?0+$/, ''),
    heightCm: v.heightCm == null ? '' : String(v.heightCm),
    headCircumferenceCm:
      v.headCircumferenceCm == null ? '' : String(v.headCircumferenceCm),
    temperatureC: v.temperatureC == null ? '' : String(v.temperatureC),
    paymentCode: v.paymentCode ?? '',
    examinations: v.examinations ?? '',
    ultrasoundNotes: v.ultrasoundNotes ?? '',
    legacyDiagnosis: v.legacyDiagnosis ?? '',
    prescription: v.prescription ?? '',
    labResults: v.labResults ?? '',
    followupNotes: v.followupNotes ?? '',
    otherNotes: v.otherNotes ?? '',
    diagnoses: [...v.diagnoses].sort((a, b) => a.orderIndex - b.orderIndex),
  };
}

/**
 * Compute the delta between two form-value snapshots, returning the
 * subset that should be PATCHed. Strings are sent as null when blank.
 * Returns `null` when nothing changed.
 *
 * Validation: weights/heights/temps are parsed via {@link parseDecimal}
 * — invalid entries are skipped (the field stays dirty so the save
 * indicator surfaces the user-visible warning). This matches the spec:
 * form validation prevents save with critical errors but allows save
 * with empty fields.
 */
export function diffFormValues(
  before: VisitFormValues,
  after: VisitFormValues,
): UpdateVisitInput | null {
  const patch: UpdateVisitInput = {};
  let changed = false;

  if (before.visitDate !== after.visitDate && after.visitDate.length > 0) {
    patch.visitDate = after.visitDate;
    changed = true;
  }
  for (const key of [
    'complaint',
    'feedingNotes',
    'examinations',
    'ultrasoundNotes',
    'legacyDiagnosis',
    'prescription',
    'labResults',
    'followupNotes',
    'otherNotes',
  ] as const) {
    if (before[key] !== after[key]) {
      patch[key] = after[key].length > 0 ? after[key] : null;
      changed = true;
    }
  }
  for (const key of ['feedingBreast', 'feedingFormula', 'feedingSolid'] as const) {
    if (before[key] !== after[key]) {
      patch[key] = after[key];
      changed = true;
    }
  }

  const weightDiff = diffWeight(before.weightKg, after.weightKg);
  if (weightDiff !== undefined) {
    patch.weightG = weightDiff;
    changed = true;
  }
  const heightDiff = diffDecimal(before.heightCm, after.heightCm);
  if (heightDiff !== undefined) {
    patch.heightCm = heightDiff;
    changed = true;
  }
  const hcDiff = diffDecimal(before.headCircumferenceCm, after.headCircumferenceCm);
  if (hcDiff !== undefined) {
    patch.headCircumferenceCm = hcDiff;
    changed = true;
  }
  const tempDiff = diffDecimal(before.temperatureC, after.temperatureC);
  if (tempDiff !== undefined) {
    patch.temperatureC = tempDiff;
    changed = true;
  }
  if (before.paymentCode !== after.paymentCode) {
    patch.paymentCode = after.paymentCode === '' ? null : after.paymentCode;
    changed = true;
  }

  if (diagnosesChanged(before.diagnoses, after.diagnoses)) {
    patch.diagnoses = after.diagnoses.map((d) => d.code);
    changed = true;
  }

  return changed ? patch : null;
}

/**
 * Order-sensitive comparison of two diagnosis chip lists. A reorder
 * counts as a change — the primary diagnosis is defined by position.
 *
 * Exported for the unit tests that pin this rule.
 */
export function diagnosesChanged(
  before: VisitDiagnosisDto[],
  after: VisitDiagnosisDto[],
): boolean {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i]!.code !== after[i]!.code) return true;
  }
  return false;
}

function diffWeight(beforeKg: string, afterKg: string): number | null | undefined {
  if (beforeKg === afterKg) return undefined;
  if (afterKg.trim().length === 0) return null;
  const parsed = parseDecimal(afterKg);
  if (parsed == null) return undefined; // invalid — skip until corrected
  if (parsed < 0) return undefined;
  // Store as grams (Visit.weightG is int). Round to integer; doctor
  // types e.g. "13.6" → 13_600 g.
  return Math.round(parsed * 1000);
}

function diffDecimal(before: string, after: string): number | null | undefined {
  if (before === after) return undefined;
  if (after.trim().length === 0) return null;
  const parsed = parseDecimal(after);
  if (parsed == null) return undefined;
  if (parsed < 0) return undefined;
  return parsed;
}

export function parseDecimal(value: string): number | null {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed.length === 0) return null;
  if (!/^-?\d*\.?\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Soft, presentational form-level validation. Returns a map of
 * field → error message. Used to mark fields red without blocking
 * the auto-save — the API does the real validation, this is just a
 * helper for the doctor to spot typos.
 */
export function validateFormValues(values: VisitFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const w = parseDecimal(values.weightKg);
  if (values.weightKg.length > 0 && (w == null || w < 0 || w > 200)) {
    errors['weightKg'] = 'Pesha duhet të jetë mes 0 dhe 200 kg';
  }
  const h = parseDecimal(values.heightCm);
  if (values.heightCm.length > 0 && (h == null || h < 0 || h > 250)) {
    errors['heightCm'] = 'Gjatësia duhet të jetë mes 0 dhe 250 cm';
  }
  const hc = parseDecimal(values.headCircumferenceCm);
  if (
    values.headCircumferenceCm.length > 0 &&
    (hc == null || hc < 0 || hc > 80)
  ) {
    errors['headCircumferenceCm'] = 'Perimetri duhet të jetë mes 0 dhe 80 cm';
  }
  const t = parseDecimal(values.temperatureC);
  if (values.temperatureC.length > 0 && (t == null || t < 25 || t > 45)) {
    errors['temperatureC'] = 'Temperatura duhet të jetë mes 25 dhe 45 °C';
  }
  return errors;
}
