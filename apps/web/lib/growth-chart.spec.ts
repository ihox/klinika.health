import { describe, expect, it } from 'vitest';

import {
  ageInMonths,
  inferSexFromFirstName,
  isToddlerAge,
  pointsForMetric,
  resolveSex,
  sexChipLabel,
  toneForSex,
  WHO_MAX_AGE_MONTHS,
} from './growth-chart';
import type { ChartGrowthPointDto } from './patient-client';
import { WHO_PERCENTILES } from './who-growth-data/who-growth-data';

// -----------------------------------------------------------------------------
// Color selection
// -----------------------------------------------------------------------------

describe('toneForSex', () => {
  it("returns 'male' for 'm' (blue convention)", () => {
    expect(toneForSex('m')).toBe('male');
  });
  it("returns 'female' for 'f' (pink convention)", () => {
    expect(toneForSex('f')).toBe('female');
  });
});

describe('sexChipLabel', () => {
  it('returns Djalë / Vajzë (Albanian labels)', () => {
    expect(sexChipLabel('m')).toBe('Djalë');
    expect(sexChipLabel('f')).toBe('Vajzë');
  });
});

// -----------------------------------------------------------------------------
// Sex resolution (explicit > name inference > null)
// -----------------------------------------------------------------------------

describe('resolveSex', () => {
  it('prefers the explicit sex column over name inference', () => {
    expect(resolveSex({ sex: 'm', firstName: 'Era' })).toBe('m');
    expect(resolveSex({ sex: 'f', firstName: 'Taulant' })).toBe('f');
  });

  it('falls back to inference when sex is missing', () => {
    expect(resolveSex({ sex: null, firstName: 'Era' })).toBe('f');
    expect(resolveSex({ sex: null, firstName: 'Taulant' })).toBe('m');
  });

  it('returns null when inference is inconclusive — caller must prompt', () => {
    expect(resolveSex({ sex: null, firstName: '' })).toBeNull();
    expect(resolveSex({ sex: null, firstName: 'Xy' })).toBeNull();
    expect(resolveSex({ sex: undefined, firstName: undefined })).toBeNull();
  });
});

describe('inferSexFromFirstName', () => {
  it.each([
    ['Era', 'f'],
    ['era', 'f'],
    ['  Era  ', 'f'], // surrounding whitespace tolerated
    ['Albulena', 'f'],
    ['Diellza', 'f'],
    ['Vlora', 'f'],
  ])('infers female for %s', (name, expected) => {
    expect(inferSexFromFirstName(name)).toBe(expected);
  });

  it.each([
    ['Taulant', 'm'],
    ['Ardit', 'm'],
    ['Liridon', 'm'],
    ['Edon', 'm'],
    ['Granit', 'm'],
  ])('infers male for %s', (name, expected) => {
    expect(inferSexFromFirstName(name)).toBe(expected);
  });

  it('returns null for ambiguous names', () => {
    expect(inferSexFromFirstName('Pat')).toBeNull();
    expect(inferSexFromFirstName(null)).toBeNull();
    expect(inferSexFromFirstName('')).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Age-in-months calculation (calendar-aware)
// -----------------------------------------------------------------------------

describe('ageInMonths', () => {
  it('returns null when the DOB is missing or malformed', () => {
    expect(ageInMonths(null)).toBeNull();
    expect(ageInMonths(undefined)).toBeNull();
    expect(ageInMonths('not-a-date')).toBeNull();
  });

  it('returns 0 the day a child is born', () => {
    expect(ageInMonths('2026-05-14', new Date('2026-05-14T08:00:00Z'))).toBe(0);
  });

  it('handles whole-month boundaries (calendar arithmetic, not 30-day approx)', () => {
    // Born Aug 3, 2023 — exactly 24 months on Aug 3, 2025.
    expect(ageInMonths('2023-08-03', new Date('2025-08-03T00:00:00Z'))).toBe(24);
    // The day before that boundary is still 23 months.
    expect(ageInMonths('2023-08-03', new Date('2025-08-02T00:00:00Z'))).toBe(23);
  });

  it('handles cross-year arithmetic correctly', () => {
    expect(ageInMonths('2024-12-15', new Date('2026-03-15T00:00:00Z'))).toBe(15);
  });
});

describe('isToddlerAge', () => {
  it('treats null age as non-toddler so the panel collapses cleanly', () => {
    expect(isToddlerAge(null)).toBe(false);
  });
  it('treats ages 0..24 inclusive as in the WHO band', () => {
    expect(isToddlerAge(0)).toBe(true);
    expect(isToddlerAge(WHO_MAX_AGE_MONTHS)).toBe(true);
  });
  it('treats >24 months as past the WHO band', () => {
    expect(isToddlerAge(25)).toBe(false);
    expect(isToddlerAge(60)).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Data-point filtering — keeps the 0–24mo band, drops missing values
// -----------------------------------------------------------------------------

const POINTS: ChartGrowthPointDto[] = [
  { visitId: 'v0', visitDate: '2023-08-15', ageMonths: 0, weightKg: 3.3, heightCm: 51, headCircumferenceCm: 34 },
  { visitId: 'v1', visitDate: '2023-11-15', ageMonths: 3, weightKg: 6.1, heightCm: 60, headCircumferenceCm: 40 },
  { visitId: 'v2', visitDate: '2024-02-15', ageMonths: 6, weightKg: 7.4, heightCm: null, headCircumferenceCm: 42 },
  { visitId: 'v3', visitDate: '2024-08-15', ageMonths: 12, weightKg: 9.5, heightCm: 74, headCircumferenceCm: 45 },
  { visitId: 'v4', visitDate: '2025-08-15', ageMonths: 24, weightKg: 12.1, heightCm: 86, headCircumferenceCm: 47.3 },
  // Out-of-band — older visit, only relevant in `all` mode.
  { visitId: 'v5', visitDate: '2026-08-15', ageMonths: 36, weightKg: 14.5, heightCm: 95, headCircumferenceCm: 49 },
];

describe('pointsForMetric', () => {
  it('drops points outside 0–24 months in the default WHO range', () => {
    const series = pointsForMetric(POINTS, 'weight');
    expect(series.points).toHaveLength(5);
    expect(series.points.every((p) => p.ageMonths >= 0 && p.ageMonths <= 24)).toBe(
      true,
    );
  });

  it("keeps everything when range='all' (historical view)", () => {
    const series = pointsForMetric(POINTS, 'weight', 'all');
    expect(series.points).toHaveLength(6);
  });

  it('drops points missing the requested metric value', () => {
    const series = pointsForMetric(POINTS, 'length');
    // v2 has heightCm=null — must not appear.
    expect(series.points.find((p) => p.visitId === 'v2')).toBeUndefined();
    expect(series.points.map((p) => p.visitId)).toEqual(['v0', 'v1', 'v3', 'v4']);
  });

  it('sorts the series ascending by age (oldest first)', () => {
    const shuffled: ChartGrowthPointDto[] = [POINTS[3]!, POINTS[0]!, POINTS[1]!];
    const series = pointsForMetric(shuffled, 'weight');
    expect(series.points.map((p) => p.ageMonths)).toEqual([0, 3, 12]);
  });

  it('emits the values in the correct unit for each metric', () => {
    const w = pointsForMetric(POINTS, 'weight').points[0];
    const l = pointsForMetric(POINTS, 'length').points[0];
    const h = pointsForMetric(POINTS, 'hc').points[0];
    expect(w?.value).toBe(3.3);
    expect(l?.value).toBe(51);
    expect(h?.value).toBe(34);
  });
});

// -----------------------------------------------------------------------------
// Percentile order is the WHO clinical convention. Painters depend on
// this order so the outer band sits under the inner band, and the
// median curve sits on top — flipping it would mis-render the chart.
// -----------------------------------------------------------------------------

describe('WHO_PERCENTILES', () => {
  it('is ordered P3 → P15 → P50 → P85 → P97 (low to high)', () => {
    expect(WHO_PERCENTILES).toEqual(['P3', 'P15', 'P50', 'P85', 'P97']);
  });
});
