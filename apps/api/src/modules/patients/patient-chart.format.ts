// Canonical age and indicator helpers for the patient chart.
//
// The web's `patient-client.ts` keeps a byte-identical mirror of
// `ageLabelChart` and `daysSinceVisitColor` so the chart UI can use
// them without crossing the network boundary. The two files must
// stay in sync — this api copy is the test-pinned source of truth.
//
// Both helpers are pure; no DOM, no Date side effects, no clock
// reads other than the optional `asOf` parameter.

export type DaysSinceVisitColor = 'red' | 'amber' | 'green';

/**
 * Compact age band for the chart master strip: "2v 3m" / "11m" /
 * "1v" / "12 ditë".
 *
 *   0–59 days       → "<N> ditë"          ("12 ditë")
 *   60 days – 11m   → "<N>m"               ("11m")
 *   12m – 23m       → "1v" or "1v Xm"      ("1v", "1v 3m")
 *   ≥ 24m           → "<Y>v" or "<Y>v Xm"  ("2v", "2v 9m")
 *
 * Returns an empty string when the DOB is null.
 */
export function ageLabelChart(
  dobIso: string | null,
  asOf: Date = new Date(),
): string {
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

/**
 * Map "days since last visit" to one of three indicator colors for
 * the chart master strip.
 *
 *   1–7      → red    (very recent — likely a follow-up)
 *   8–30     → amber  (within the month)
 *   > 30     → green
 *   null/0   → green  (no prior visit, or already in today)
 */
export function daysSinceVisitColor(days: number | null): DaysSinceVisitColor {
  if (days == null) return 'green';
  if (days <= 0) return 'green';
  if (days <= 7) return 'red';
  if (days <= 30) return 'amber';
  return 'green';
}
