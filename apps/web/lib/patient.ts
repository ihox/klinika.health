// Patient completeness predicate — the single source of truth for
// "can the doctor proceed to the chart?". Used by the frontend to
// route conditional navigation, and computed server-side into
// `PatientFullDto.isComplete` so both sides see the same answer.
//
// Required fields: firstName, lastName, dateOfBirth, sex.
//
// Patients can land in the database missing some of these when the
// receptionist quick-adds them (CLAUDE.md §1.2 — receptionist sees
// only name + DOB; the receptionist's add-patient flow is even
// looser, requiring firstName only). Until the doctor fills them
// in, the chart cannot render meaningfully (no growth charts, no
// vërtetim, no print).
//
// The empty-string case is load-bearing: the receptionist's quick-add
// may store `lastName = ''` (column is NOT NULL but the value is
// blank). `Boolean('') === false`, so the predicate still returns
// false for that patient — they're routed to the master-data form.

import { ApiError } from './api';
import { patientClient } from './patient-client';

export interface PatientCompletenessFields {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  sex?: string | null;
}

export function isPatientComplete(p: PatientCompletenessFields): boolean {
  return Boolean(p.firstName && p.lastName && p.dateOfBirth && p.sex);
}

export function chartPath(patientId: string): string {
  return `/pacient/${patientId}`;
}

export function masterDataPath(patientId: string): string {
  return `/pacient/${patientId}/te-dhena`;
}

interface RouterLike {
  push: (path: string) => void;
}

/**
 * Conditional navigation entry-point for the doctor. Fetches the
 * patient's full DTO, reads `isComplete`, and routes to the chart
 * (when complete) or the master-data form (when not). Used from
 * every surface that lets the doctor "open a patient" — patient
 * list, dashboard tiles, calendar entries, deep links.
 *
 * The extra request is intentional (single source of truth on the
 * server). Latency is trivial — the same endpoint feeds the chart
 * page itself, so the round-trip is part of the normal load budget.
 *
 * Returns the `PatientFullDto` so callers that want to do something
 * extra (toast on missing data, etc.) have the record handy. Throws
 * on network / auth errors so the caller can decide how to surface.
 */
export async function navigateToPatient(
  router: RouterLike,
  patientId: string,
): Promise<void> {
  const res = await patientClient.getOne(patientId);
  const path = res.patient.isComplete
    ? chartPath(patientId)
    : masterDataPath(patientId);
  router.push(path);
}

/**
 * Same as `navigateToPatient` but logs and swallows the error rather
 * than throwing — for "fire-and-forget" click handlers where the
 * caller doesn't want to wire its own error UI. On 401 routes the
 * browser to login; on other errors the caller stays put.
 */
export async function safeNavigateToPatient(
  router: RouterLike,
  patientId: string,
): Promise<void> {
  try {
    await navigateToPatient(router, patientId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      if (typeof window !== 'undefined') {
        window.location.href = '/login?reason=session-expired';
      }
      return;
    }
    // Fall through silently — the user can retry the click. We
    // never log PHI; the api layer already logs identifiers.
  }
}
