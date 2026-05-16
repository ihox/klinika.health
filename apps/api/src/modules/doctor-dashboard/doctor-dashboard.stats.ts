// Day-stats aggregation for the doctor's home screen.
//
// Pure helper kept separate from the service so the calculation can
// be unit-tested without spinning up Prisma. The service hands in
// today's completed visits plus the day-total clinical-scope count;
// this returns the four numbers that drive the stats card:
//
//   - visitsCompleted    (count of today's completed visits, clinical
//                         scope: scheduled + walk-in + standalone)
//   - appointmentsTotal  (count of ALL today's visits, any status,
//                         clinical scope; matches receptionist's
//                         /calendar/stats.total by construction)
//   - appointmentsCompleted (equals visitsCompleted by construction;
//                            retained for backward-compatibility with
//                            consumers that still read it — could be
//                            collapsed in v1.x)
//   - averageVisitMinutes (mean gap between consecutive visit saves;
//                          null when fewer than two visits exist)
//   - paymentsCents      (sum of each visit's paymentCode amount in
//                         today's payment-code map; visits with a code
//                         that has been deleted from the clinic's
//                         configuration contribute 0 rather than
//                         erroring — the doctor's stats should never
//                         500 because of a config drift)
//
// All inputs are already scoped to the requesting clinic by the
// caller, so the helper itself is generic.

export interface VisitLike {
  paymentCode: string | null;
  createdAt: Date;
}

export type PaymentAmountResolver = (code: string) => number | null;

export interface DayStatsResult {
  visitsCompleted: number;
  appointmentsTotal: number;
  appointmentsCompleted: number;
  averageVisitMinutes: number | null;
  paymentsCents: number;
}

/**
 * The "average minutes per visit" tile reads as a calmness signal —
 * is today running long or short? — so we want a stable, robust
 * estimator. We use the mean gap between successive `createdAt`
 * stamps on today's visits, capped at 4 hours each so a lunch break
 * doesn't blow up the average.
 *
 * Returns null when fewer than two visits exist (no gap to measure).
 */
export function averageVisitMinutes(visits: VisitLike[]): number | null {
  if (visits.length < 2) return null;
  const sorted = visits
    .map((v) => v.createdAt.getTime())
    .sort((a, b) => a - b);
  let total = 0;
  let count = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1] as number;
    const curr = sorted[i] as number;
    const gapMin = (curr - prev) / 60_000;
    if (gapMin <= 0) continue;
    const capped = Math.min(gapMin, 240);
    total += capped;
    count += 1;
  }
  if (count === 0) return null;
  return Math.round((total / count) * 10) / 10;
}

export function computeDayStats(opts: {
  /** Today's completed visits (clinical scope; one row per shape). */
  visits: VisitLike[];
  /**
   * Count of ALL today's visits in clinical scope (any status, not
   * deleted) — matches receptionist's `/calendar/stats.total`. The
   * service computes this with a single `visit.count` so the doctor
   * and receptionist views agree by construction (PR 2 of the
   * cross-view parity fix).
   */
  dayTotalCount: number;
  paymentAmount: PaymentAmountResolver;
}): DayStatsResult {
  const { visits, dayTotalCount, paymentAmount } = opts;
  let paymentsCents = 0;
  for (const v of visits) {
    if (!v.paymentCode) continue;
    const amount = paymentAmount(v.paymentCode);
    if (typeof amount === 'number') paymentsCents += amount;
  }
  const visitsCompleted = visits.length;
  return {
    visitsCompleted,
    appointmentsTotal: dayTotalCount,
    // Equals visitsCompleted by construction now that both fields
    // count today's completed visits across all shapes (scheduled,
    // walk-in, standalone). Retained as a separate field for
    // backward-compatibility with the DTO; a future refactor could
    // collapse the two.
    appointmentsCompleted: visitsCompleted,
    averageVisitMinutes: averageVisitMinutes(visits),
    paymentsCents,
  };
}
