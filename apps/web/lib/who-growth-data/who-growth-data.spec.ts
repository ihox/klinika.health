import { describe, expect, it } from 'vitest';

import {
  estimatePercentileLabel,
  getWhoReference,
  interpolatePercentile,
  WHO_PERCENTILES,
} from './who-growth-data';

describe('getWhoReference', () => {
  it('returns 25 monthly points (0..24 inclusive) for every metric × sex', () => {
    for (const metric of ['weight', 'length', 'hc'] as const) {
      for (const sex of ['m', 'f'] as const) {
        const ref = getWhoReference(metric, sex);
        expect(ref.ages).toHaveLength(25);
        for (const p of WHO_PERCENTILES) {
          expect(ref[p]).toHaveLength(25);
        }
      }
    }
  });

  it('keeps percentile values strictly increasing (P3 < P15 < P50 < P85 < P97)', () => {
    for (const metric of ['weight', 'length', 'hc'] as const) {
      for (const sex of ['m', 'f'] as const) {
        const ref = getWhoReference(metric, sex);
        for (let i = 0; i < 25; i++) {
          expect(ref.P3[i]!).toBeLessThan(ref.P15[i]!);
          expect(ref.P15[i]!).toBeLessThan(ref.P50[i]!);
          expect(ref.P50[i]!).toBeLessThan(ref.P85[i]!);
          expect(ref.P85[i]!).toBeLessThan(ref.P97[i]!);
        }
      }
    }
  });

  it('reference curves are non-decreasing month over month (growth never reverses)', () => {
    for (const metric of ['weight', 'length', 'hc'] as const) {
      for (const sex of ['m', 'f'] as const) {
        const ref = getWhoReference(metric, sex);
        for (const p of WHO_PERCENTILES) {
          const series = ref[p];
          for (let i = 1; i < series.length; i++) {
            expect(series[i]!).toBeGreaterThanOrEqual(series[i - 1]!);
          }
        }
      }
    }
  });

  it('differentiates boys vs girls (sex matters clinically)', () => {
    const boys = getWhoReference('weight', 'm');
    const girls = getWhoReference('weight', 'f');
    // The WHO published curves diverge meaningfully by month 12+ — the
    // shared zero-month value is fine but the later values must differ.
    expect(boys.P50[12]).not.toBe(girls.P50[12]);
    expect(boys.P50[24]).not.toBe(girls.P50[24]);
  });
});

describe('interpolatePercentile', () => {
  it('returns the exact value at an integer month', () => {
    const ref = getWhoReference('weight', 'm');
    expect(interpolatePercentile(ref.P50, 0)).toBeCloseTo(ref.P50[0]!, 6);
    expect(interpolatePercentile(ref.P50, 12)).toBeCloseTo(ref.P50[12]!, 6);
    expect(interpolatePercentile(ref.P50, 24)).toBeCloseTo(ref.P50[24]!, 6);
  });

  it('linearly interpolates between adjacent months', () => {
    const ref = getWhoReference('weight', 'm');
    const half = (ref.P50[6]! + ref.P50[7]!) / 2;
    expect(interpolatePercentile(ref.P50, 6.5)).toBeCloseTo(half, 6);
  });

  it('clamps out-of-range ages to the nearest endpoint', () => {
    const ref = getWhoReference('weight', 'm');
    expect(interpolatePercentile(ref.P50, -3)).toBe(ref.P50[0]);
    expect(interpolatePercentile(ref.P50, 100)).toBe(ref.P50[24]);
  });
});

describe('estimatePercentileLabel', () => {
  it('returns the exact percentile when the value lands on a reference curve', () => {
    const ref = getWhoReference('weight', 'm');
    expect(estimatePercentileLabel(ref, 0, ref.P50[0]!)).toBe('P50');
    expect(estimatePercentileLabel(ref, 12, ref.P3[12]!)).toBe('P3');
    expect(estimatePercentileLabel(ref, 12, ref.P97[12]!)).toBe('P97');
  });

  it('flags values below P3 with the < marker (clinical out-of-band)', () => {
    const ref = getWhoReference('weight', 'm');
    expect(estimatePercentileLabel(ref, 12, 0)).toBe('<P3');
  });

  it('flags values above P97 with the > marker', () => {
    const ref = getWhoReference('weight', 'm');
    expect(estimatePercentileLabel(ref, 12, 99)).toBe('>P97');
  });
});
