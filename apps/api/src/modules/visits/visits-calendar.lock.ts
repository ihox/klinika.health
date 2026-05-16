// Receptionist edit-lock predicate.
//
// Daily reports include money summaries derived from `completed` visit
// rows. Without a lock, the receptionist could (intentionally or
// accidentally) mutate completed/past visits and corrupt the report.
// This module owns the single source of truth for the lock rule so
// the controller, service, and any future surface all agree.
//
// The rule:
//
//   A visit is LOCKED for the receptionist when EITHER
//     (a) it's on a past clinic day (yesterday or earlier), regardless
//         of status, OR
//     (b) it's on today's date AND status === 'completed'.
//
//   A visit is UNLOCKED for the receptionist when
//     - it's today AND status ∈ {scheduled, arrived, in_progress,
//       no_show}, OR
//     - it's a future day (any status).
//
// Doctor and clinic_admin are NEVER restricted by this rule — call
// sites must gate on `isReceptionistOnly(ctx.roles)` before invoking
// this predicate. The lock transitions at midnight clinic-local time:
// a `scheduled` row at 23:55 stays editable until 00:00 when it
// becomes yesterday's; a `completed` row at 23:55 was already locked
// from its completion onward.

import { localDateOf } from '../../common/datetime';

/**
 * Narrow input shape so callers can pass either a full Prisma `Visit`
 * row or a slim select. `visitDate` is the `@db.Date` column; Prisma
 * returns it as a Date whose UTC components carry the local date (per
 * ADR-006 §DATE vs Timestamptz), which is what we need.
 */
export interface LockableVisit {
  status: string;
  visitDate: Date | string;
}

/**
 * Returns true iff `visit` is locked from receptionist edits.
 *
 * Doctor and clinic_admin sessions are NEVER restricted — gate at the
 * caller (`isReceptionistOnly(ctx.roles)`) before invoking this.
 */
export function isVisitLockedForReceptionist(
  visit: LockableVisit,
  clinicTimezone: string = 'Europe/Belgrade',
): boolean {
  const today = localDateOf(new Date(), clinicTimezone);
  const visitDateStr = visitDateAsLocalString(visit.visitDate);
  if (visitDateStr < today) return true;
  if (visitDateStr === today && visit.status === 'completed') return true;
  return false;
}

/**
 * Extract `YYYY-MM-DD` from a `visit_date` value.
 *
 * `@db.Date` columns round-trip through Prisma as Date instances whose
 * UTC year/month/day match the stored local date (ADR-006). We read
 * the UTC parts directly to avoid a re-zoning round-trip that would
 * be both unnecessary and offset/DST-prone.
 *
 * Accepts a `YYYY-MM-DD` string verbatim for callers that have
 * already serialized the column (e.g. DTOs).
 */
function visitDateAsLocalString(value: Date | string): string {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    // Fall back to parsing — keeps the predicate robust against
    // unexpected serializations without paying the local-zone cost.
    const d = new Date(value);
    return formatUtcDate(d);
  }
  return formatUtcDate(value);
}

function formatUtcDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
