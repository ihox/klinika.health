// Day-stats aggregation for the doctor's home screen.
//
// Pure helper kept separate from the service so the calculation can
// be unit-tested without spinning up Prisma. The service hands in the
// raw visit + appointment rows for the local day, and this returns
// the four numbers that drive the stats card:
//
//   - visitsCompleted    (count of today's saved visits)
//   - appointmentsTotal  (all non-deleted appointments)
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

export interface AppointmentLike {
  // Post-merge `visits.status` is TEXT with six allowed values
  // (`scheduled | arrived | in_progress | completed | no_show | cancelled`);
  // the stats only need to count 'completed' vs everything else, so the
  // type is intentionally widened to `string` to accept the unified column.
  status: string;
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
  visits: VisitLike[];
  appointments: AppointmentLike[];
  paymentAmount: PaymentAmountResolver;
}): DayStatsResult {
  const { visits, appointments, paymentAmount } = opts;
  let paymentsCents = 0;
  for (const v of visits) {
    if (!v.paymentCode) continue;
    const amount = paymentAmount(v.paymentCode);
    if (typeof amount === 'number') paymentsCents += amount;
  }
  const appointmentsCompleted = appointments.filter(
    (a) => a.status === 'completed',
  ).length;
  return {
    visitsCompleted: visits.length,
    appointmentsTotal: appointments.length,
    appointmentsCompleted,
    averageVisitMinutes: averageVisitMinutes(visits),
    paymentsCents,
  };
}
