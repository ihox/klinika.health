// Pure helpers shared by /raporti (on-screen) and /raporti/print
// (A4 template). Kept dependency-free so they can be unit-tested
// without React.

import type {
  DailyReportStatus,
  DailyReportVisit,
} from '@/lib/daily-report-client';

const MONTHS_SHORT_SQ = [
  'jan',
  'shk',
  'mar',
  'pri',
  'maj',
  'qer',
  'kor',
  'gus',
  'sht',
  'tet',
  'nën',
  'dhj',
];

/** Step a `YYYY-MM-DD` local date by N days (UTC arithmetic). */
export function stepDay(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Compact Albanian date label — "22 maj 2026". */
export function formatCompactSq(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS_SHORT_SQ[m - 1] ?? ''} ${y}`;
}

/** Day-of-month dot format used on the print version — "22.05.2026". */
export function formatDl(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '—';
  return `${d}.${m}.${y}`;
}

/** Render cents → "235" (no decimals — matches the prototype copy). */
export function centsToEur(cents: number): string {
  return Math.round(cents / 100).toString();
}

/** True iff the visit contributed cash to the daily total (excludes E=Falas). */
export function isPaid(v: DailyReportVisit): boolean {
  return (
    v.status === 'completed' &&
    v.paymentCode != null &&
    v.paymentCode !== 'E'
  );
}

/** Number of paid rows in a filtered subset. */
export function countPaid(visits: DailyReportVisit[]): number {
  return visits.filter(isPaid).length;
}

/** Sum of completed-visit amounts in a subset (cents). E is included as 0. */
export function sumCents(visits: DailyReportVisit[]): number {
  return visits.reduce(
    (sum, v) =>
      v.status === 'completed' && v.paymentAmountCents != null
        ? sum + v.paymentAmountCents
        : sum,
    0,
  );
}

/** Albanian chip label for a visit status. */
export function chipLabel(status: DailyReportStatus): string {
  switch (status) {
    case 'completed':
      return 'Përfunduar';
    case 'no_show':
      return 'Mungesë';
    case 'scheduled':
      return 'I planifikuar';
    case 'arrived':
      return 'Paraqitur';
    case 'in_progress':
      return 'Në vizitë';
  }
}

/** Receptionist-only check (mirrors apps/api/src/common/request-context/role-helpers.ts). */
export function isReceptionistOnlyRoles(roles: readonly string[]): boolean {
  if (roles.includes('doctor') || roles.includes('clinic_admin')) return false;
  return roles.includes('receptionist');
}

/**
 * Render the on-screen day greeting based on the local clock — used by
 * the top header. Returns "Mirëmëngjes" / "Mirëdita" / "Mirëmbrëma" +
 * the user's first name when known.
 */
export function buildGreeting(firstName: string, now: Date = new Date()): string {
  const hour = now.getHours();
  const lead = hour < 12 ? 'Mirëmëngjes' : hour < 18 ? 'Mirëdita' : 'Mirëmbrëma';
  return firstName ? `${lead}, ${firstName}` : lead;
}

/** First role to surface as the page-header pill label. */
export function primaryRoleFor(roles: readonly string[]): string {
  if (roles.includes('doctor')) return 'Mjeku';
  if (roles.includes('clinic_admin')) return 'Administrator';
  if (roles.includes('receptionist')) return 'Recepsioniste';
  return '';
}
