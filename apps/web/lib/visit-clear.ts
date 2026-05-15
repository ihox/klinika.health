// "Pastro vizitën" (Phase 2c) — visibility predicate.
//
// The action is only available when ALL of:
//   - the visit is `completed`
//   - the visit is today (clinic-local, Europe/Belgrade)
//   - the user has a clinical role (doctor or clinic_admin)
//
// Receptionist-only sessions never reach the chart, but the predicate
// guards anyway as defense in depth.

import type { VisitDto } from './visit-client';

const BELGRADE_TZ = 'Europe/Belgrade';

export function canClearVisit(
  visit: Pick<VisitDto, 'status' | 'visitDate'>,
  roles: readonly string[],
  now: Date = new Date(),
): boolean {
  if (!hasClinicalRole(roles)) return false;
  if (visit.status !== 'completed') return false;
  if (visit.visitDate !== belgradeToday(now)) return false;
  return true;
}

function hasClinicalRole(roles: readonly string[]): boolean {
  return roles.includes('doctor') || roles.includes('clinic_admin');
}

/**
 * YYYY-MM-DD for the given instant in Europe/Belgrade. `sv-SE` formats
 * day-anchored without localisation surprises and is robust regardless
 * of host TZ — matches the server-side `localDateToday()` shape.
 */
export function belgradeToday(now: Date = new Date()): string {
  return now.toLocaleDateString('sv-SE', { timeZone: BELGRADE_TZ });
}
