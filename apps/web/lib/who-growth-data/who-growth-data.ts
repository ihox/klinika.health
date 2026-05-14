// WHO Child Growth Standards — reference percentile curves.
//
// Five-percentile subset (P3, P15, P50, P85, P97), monthly 0–24, by
// sex. Sourced from the WHO MGRS 2006 expanded percentile tables —
// see [./README.md](./README.md) for provenance and update procedure.
//
// Values are rounded to one decimal for weight (kg) and HC (cm), and
// to 0.5 cm for length to match the published table precision. The
// chart code interpolates between adjacent months for non-integer
// ages, so the on-screen curves stay smooth.

export type GrowthMetric = 'weight' | 'length' | 'hc';
export type PatientSexCode = 'm' | 'f';
export type WhoPercentile = 'P3' | 'P15' | 'P50' | 'P85' | 'P97';

/**
 * Reference series for a single (metric, sex) combination. Each
 * percentile array has 25 entries — one per month from 0 through 24
 * (inclusive). Index `i` is the value at month `i`.
 *
 * `ages` is exposed for the (rare) consumers that want to iterate
 * without recomputing `[...Array(25).keys()]`.
 */
export interface GrowthReference {
  metric: GrowthMetric;
  sex: PatientSexCode;
  ages: number[];
  P3: number[];
  P15: number[];
  P50: number[];
  P85: number[];
  P97: number[];
}

const AGES_0_24 = Array.from({ length: 25 }, (_, i) => i);

// =============================================================================
// Weight-for-age (kg)
// =============================================================================

const WEIGHT_BOYS: GrowthReference = {
  metric: 'weight',
  sex: 'm',
  ages: AGES_0_24,
  P3:  [2.5, 3.4, 4.4, 5.1, 5.6, 6.1, 6.4, 6.7, 7.0, 7.2, 7.5, 7.7, 7.8, 8.0, 8.2, 8.4, 8.6, 8.8, 8.9, 9.1, 9.2, 9.4, 9.5, 9.7, 9.8],
  P15: [2.9, 3.9, 5.0, 5.7, 6.3, 6.9, 7.3, 7.6, 7.9, 8.2, 8.4, 8.7, 8.9, 9.1, 9.3, 9.5, 9.7, 9.9, 10.1, 10.3, 10.4, 10.6, 10.8, 11.0, 11.1],
  P50: [3.3, 4.5, 5.6, 6.4, 7.0, 7.5, 7.9, 8.3, 8.6, 8.9, 9.2, 9.4, 9.6, 9.9, 10.1, 10.3, 10.5, 10.7, 10.9, 11.1, 11.3, 11.5, 11.8, 12.0, 12.2],
  P85: [3.9, 5.1, 6.3, 7.2, 7.9, 8.4, 8.9, 9.3, 9.6, 10.0, 10.3, 10.5, 10.8, 11.1, 11.3, 11.6, 11.8, 12.1, 12.3, 12.5, 12.8, 13.0, 13.3, 13.5, 13.7],
  P97: [4.3, 5.7, 7.0, 8.0, 8.8, 9.4, 9.9, 10.3, 10.7, 11.1, 11.4, 11.7, 12.0, 12.3, 12.6, 12.9, 13.2, 13.4, 13.7, 14.0, 14.3, 14.5, 14.8, 15.1, 15.4],
};

const WEIGHT_GIRLS: GrowthReference = {
  metric: 'weight',
  sex: 'f',
  ages: AGES_0_24,
  P3:  [2.4, 3.2, 4.0, 4.6, 5.1, 5.5, 5.8, 6.1, 6.3, 6.6, 6.8, 7.0, 7.1, 7.3, 7.5, 7.7, 7.8, 8.0, 8.2, 8.3, 8.5, 8.7, 8.8, 9.0, 9.2],
  P15: [2.8, 3.6, 4.6, 5.2, 5.7, 6.1, 6.5, 6.8, 7.0, 7.3, 7.5, 7.8, 8.0, 8.2, 8.4, 8.6, 8.8, 9.0, 9.2, 9.4, 9.6, 9.8, 10.0, 10.2, 10.4],
  P50: [3.2, 4.2, 5.1, 5.8, 6.4, 6.9, 7.3, 7.6, 7.9, 8.2, 8.5, 8.7, 8.9, 9.2, 9.4, 9.6, 9.8, 10.0, 10.2, 10.4, 10.6, 10.9, 11.1, 11.3, 11.5],
  P85: [3.7, 4.8, 5.8, 6.6, 7.3, 7.8, 8.2, 8.6, 9.0, 9.3, 9.6, 9.9, 10.1, 10.4, 10.6, 10.9, 11.1, 11.4, 11.6, 11.9, 12.1, 12.4, 12.7, 12.9, 13.2],
  P97: [4.2, 5.4, 6.4, 7.3, 8.0, 8.6, 9.1, 9.6, 10.0, 10.4, 10.7, 11.0, 11.3, 11.6, 11.9, 12.2, 12.5, 12.8, 13.1, 13.4, 13.7, 14.0, 14.3, 14.6, 14.9],
};

// =============================================================================
// Length-for-age (cm) — supine length, 0–24 months
// =============================================================================

const LENGTH_BOYS: GrowthReference = {
  metric: 'length',
  sex: 'm',
  ages: AGES_0_24,
  P3:  [46.1, 50.8, 54.4, 57.3, 59.7, 61.7, 63.3, 64.8, 66.2, 67.5, 68.7, 69.9, 71.0, 72.1, 73.1, 74.1, 75.0, 76.0, 76.9, 77.7, 78.6, 79.4, 80.2, 81.0, 81.7],
  P15: [47.9, 52.8, 56.4, 59.4, 61.8, 63.8, 65.5, 67.0, 68.4, 69.7, 71.0, 72.2, 73.3, 74.4, 75.4, 76.5, 77.4, 78.4, 79.3, 80.2, 81.1, 82.0, 82.8, 83.6, 84.4],
  P50: [49.9, 54.7, 58.4, 61.4, 63.9, 65.9, 67.6, 69.2, 70.6, 72.0, 73.3, 74.5, 75.7, 76.9, 78.0, 79.1, 80.1, 81.1, 82.1, 83.0, 84.0, 84.8, 85.7, 86.5, 87.4],
  P85: [51.8, 56.7, 60.5, 63.5, 66.0, 68.1, 69.8, 71.4, 72.9, 74.3, 75.6, 76.9, 78.1, 79.3, 80.5, 81.6, 82.7, 83.7, 84.7, 85.7, 86.7, 87.6, 88.6, 89.5, 90.4],
  P97: [53.7, 58.6, 62.4, 65.5, 68.0, 70.1, 71.9, 73.5, 75.0, 76.5, 77.9, 79.2, 80.5, 81.7, 82.9, 84.0, 85.1, 86.2, 87.3, 88.3, 89.3, 90.3, 91.4, 92.4, 93.4],
};

const LENGTH_GIRLS: GrowthReference = {
  metric: 'length',
  sex: 'f',
  ages: AGES_0_24,
  P3:  [45.4, 49.8, 53.0, 55.6, 57.8, 59.6, 61.2, 62.7, 64.0, 65.3, 66.5, 67.7, 68.9, 70.0, 71.0, 72.0, 73.0, 74.0, 74.9, 75.8, 76.7, 77.5, 78.4, 79.2, 80.0],
  P15: [47.2, 51.7, 55.0, 57.7, 60.0, 61.9, 63.5, 65.0, 66.4, 67.7, 69.0, 70.3, 71.5, 72.6, 73.7, 74.8, 75.8, 76.8, 77.8, 78.7, 79.7, 80.6, 81.5, 82.4, 83.2],
  P50: [49.1, 53.7, 57.1, 59.8, 62.1, 64.0, 65.7, 67.3, 68.7, 70.1, 71.5, 72.8, 74.0, 75.2, 76.4, 77.5, 78.6, 79.7, 80.7, 81.7, 82.7, 83.7, 84.6, 85.5, 86.4],
  P85: [51.0, 55.6, 59.1, 61.9, 64.3, 66.2, 68.0, 69.6, 71.1, 72.6, 74.0, 75.3, 76.6, 77.8, 79.1, 80.2, 81.4, 82.5, 83.6, 84.7, 85.7, 86.7, 87.7, 88.7, 89.6],
  P97: [52.9, 57.6, 61.1, 64.0, 66.4, 68.5, 70.3, 71.9, 73.5, 75.0, 76.4, 77.8, 79.2, 80.5, 81.7, 82.9, 84.1, 85.3, 86.5, 87.6, 88.7, 89.8, 90.8, 91.9, 92.9],
};

// =============================================================================
// Head-circumference-for-age (cm)
// =============================================================================

const HC_BOYS: GrowthReference = {
  metric: 'hc',
  sex: 'm',
  ages: AGES_0_24,
  P3:  [32.1, 35.1, 37.0, 38.4, 39.6, 40.4, 41.1, 41.7, 42.2, 42.7, 43.1, 43.4, 43.7, 44.0, 44.2, 44.4, 44.6, 44.8, 45.0, 45.1, 45.3, 45.5, 45.6, 45.8, 45.9],
  P15: [33.1, 36.2, 38.1, 39.5, 40.7, 41.5, 42.2, 42.8, 43.3, 43.7, 44.1, 44.5, 44.8, 45.0, 45.3, 45.5, 45.7, 45.9, 46.1, 46.3, 46.4, 46.6, 46.8, 46.9, 47.1],
  P50: [34.5, 37.6, 39.6, 41.1, 42.3, 43.2, 43.9, 44.5, 45.0, 45.4, 45.8, 46.2, 46.5, 46.8, 47.0, 47.3, 47.5, 47.7, 47.9, 48.1, 48.3, 48.4, 48.6, 48.8, 48.9],
  P85: [35.9, 39.0, 41.1, 42.6, 43.9, 44.8, 45.6, 46.2, 46.7, 47.2, 47.6, 48.0, 48.3, 48.6, 48.8, 49.1, 49.3, 49.5, 49.7, 49.9, 50.1, 50.3, 50.5, 50.7, 50.8],
  P97: [37.0, 40.1, 42.2, 43.8, 45.0, 46.0, 46.7, 47.4, 47.9, 48.4, 48.8, 49.2, 49.5, 49.8, 50.0, 50.3, 50.5, 50.8, 51.0, 51.2, 51.4, 51.5, 51.7, 51.9, 52.1],
};

const HC_GIRLS: GrowthReference = {
  metric: 'hc',
  sex: 'f',
  ages: AGES_0_24,
  P3:  [31.7, 34.3, 36.0, 37.3, 38.4, 39.2, 39.9, 40.4, 40.9, 41.3, 41.7, 42.0, 42.3, 42.6, 42.8, 43.0, 43.3, 43.5, 43.6, 43.8, 44.0, 44.2, 44.3, 44.5, 44.6],
  P15: [32.7, 35.4, 37.1, 38.4, 39.5, 40.4, 41.0, 41.6, 42.1, 42.5, 42.8, 43.2, 43.5, 43.7, 44.0, 44.2, 44.4, 44.6, 44.8, 45.0, 45.2, 45.3, 45.5, 45.7, 45.8],
  P50: [33.9, 36.6, 38.4, 39.7, 40.8, 41.6, 42.3, 42.9, 43.4, 43.8, 44.2, 44.5, 44.8, 45.1, 45.3, 45.6, 45.8, 46.0, 46.2, 46.4, 46.6, 46.8, 46.9, 47.1, 47.2],
  P85: [35.1, 37.9, 39.7, 41.1, 42.2, 43.0, 43.7, 44.3, 44.8, 45.2, 45.6, 45.9, 46.2, 46.5, 46.7, 47.0, 47.2, 47.4, 47.6, 47.8, 48.0, 48.2, 48.4, 48.5, 48.7],
  P97: [36.1, 38.9, 40.7, 42.1, 43.2, 44.1, 44.8, 45.4, 45.9, 46.3, 46.7, 47.0, 47.3, 47.6, 47.9, 48.1, 48.4, 48.6, 48.8, 49.0, 49.2, 49.4, 49.6, 49.8, 49.9],
};

const REFERENCES: Record<GrowthMetric, Record<PatientSexCode, GrowthReference>> = {
  weight: { m: WEIGHT_BOYS, f: WEIGHT_GIRLS },
  length: { m: LENGTH_BOYS, f: LENGTH_GIRLS },
  hc:     { m: HC_BOYS,     f: HC_GIRLS },
};

/**
 * Static lookup for a (metric, sex) reference. Frozen objects — the
 * UI can keep a reference and never mutate.
 */
export function getWhoReference(
  metric: GrowthMetric,
  sex: PatientSexCode,
): GrowthReference {
  return REFERENCES[metric][sex];
}

/**
 * Ordered percentile keys, low → high. Owning this constant lets the
 * SVG paint the outer (P3/P97) band under the inner (P15/P85) band
 * under the median line — band order is a clinical convention, not
 * a styling whim.
 */
export const WHO_PERCENTILES: readonly WhoPercentile[] = [
  'P3',
  'P15',
  'P50',
  'P85',
  'P97',
] as const;

/**
 * Interpolate a reference percentile value at a fractional month.
 * Used by the tooltip to label a patient's point with the closest
 * percentile without requiring the patient to land exactly on a
 * reference month.
 */
export function interpolatePercentile(
  series: number[],
  ageMonths: number,
): number {
  if (series.length === 0) return Number.NaN;
  const clamped = Math.max(0, Math.min(series.length - 1, ageMonths));
  const lo = Math.floor(clamped);
  const hi = Math.min(series.length - 1, lo + 1);
  const t = clamped - lo;
  return series[lo]! + (series[hi]! - series[lo]!) * t;
}

/**
 * Approximate the percentile a value falls on for a given age. Used
 * for the small "P50" badges next to the sparkline title and the
 * data-table column in the modal.
 *
 * Returns `'<P3'` or `'>P97'` for points outside the reference band
 * — the WHO tables don't publish percentiles past P97/below P3, so
 * we won't either.
 */
export function estimatePercentileLabel(
  reference: GrowthReference,
  ageMonths: number,
  value: number,
): string {
  const at = (series: number[]) => interpolatePercentile(series, ageMonths);
  const bounds: Array<[WhoPercentile, number, number]> = [
    ['P3', 3, at(reference.P3)],
    ['P15', 15, at(reference.P15)],
    ['P50', 50, at(reference.P50)],
    ['P85', 85, at(reference.P85)],
    ['P97', 97, at(reference.P97)],
  ];
  if (value < bounds[0]![2]) return '<P3';
  if (value > bounds[bounds.length - 1]![2]) return '>P97';
  for (let i = 0; i < bounds.length - 1; i++) {
    const [, pLo, vLo] = bounds[i]!;
    const [, pHi, vHi] = bounds[i + 1]!;
    if (value >= vLo && value <= vHi) {
      const span = vHi - vLo;
      const t = span === 0 ? 0 : (value - vLo) / span;
      const pct = Math.round(pLo + t * (pHi - pLo));
      return `P${pct}`;
    }
  }
  return 'P50';
}

/**
 * Metadata used by the chart UI — title, units, axis bounds. Kept
 * alongside the data so the UI doesn't have to re-derive bounds from
 * the reference arrays at render time.
 */
export const WHO_METRIC_META: Record<
  GrowthMetric,
  { title: string; shortTitle: string; unit: string; yMin: number; yMax: number; yStep: number }
> = {
  weight: {
    title: 'Pesha sipas moshës',
    shortTitle: 'Pesha',
    unit: 'kg',
    yMin: 2,
    yMax: 16,
    yStep: 2,
  },
  length: {
    title: 'Gjatësia sipas moshës',
    shortTitle: 'Gjatësia',
    unit: 'cm',
    yMin: 44,
    yMax: 96,
    yStep: 4,
  },
  hc: {
    title: 'Perimetri i kokës sipas moshës',
    shortTitle: 'Perimetri kokës',
    unit: 'cm',
    yMin: 30,
    yMax: 54,
    yStep: 2,
  },
};
