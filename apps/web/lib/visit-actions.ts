// Predicates for the visit-form's status-change affordances.
//
// "Përfundo vizitën" — primary completion CTA. Available when the
// visit is in an active state (arrived | in_progress) AND the user
// holds clinical access.
//
// "Anulo statusin" — escape hatch back into editing. Available when
// the visit is completed AND on today (clinic-local, Europe/Belgrade)
// AND the user holds clinical access. Past-day completed visits stay
// locked — they belong to closed daily reports.
//
// Server is authoritative (`ALLOWED_TRANSITIONS`, receptionist edit-
// lock, role guards). These predicates exist so the UI can hide the
// affordances proactively rather than letting the user click into a
// 400/403.

import { toLocalParts } from './appointment-client';
import type { VisitDto } from './visit-client';

export function hasClinicalAccess(roles: readonly string[]): boolean {
  return roles.includes('doctor') || roles.includes('clinic_admin');
}

export function canCompleteVisit(
  visit: Pick<VisitDto, 'status'>,
  roles: readonly string[],
): boolean {
  if (!hasClinicalAccess(roles)) return false;
  return visit.status === 'arrived' || visit.status === 'in_progress';
}

export function canRevertStatus(
  visit: Pick<VisitDto, 'status' | 'visitDate'>,
  roles: readonly string[],
  now: Date = new Date(),
): boolean {
  if (!hasClinicalAccess(roles)) return false;
  if (visit.status !== 'completed') return false;
  return visit.visitDate === toLocalParts(now).date;
}
