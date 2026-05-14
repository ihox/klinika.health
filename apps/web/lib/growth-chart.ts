// Growth-chart helpers — sex resolution, color selection, age-range
// filtering. Pure functions, no React. Used by both the sparkline
// cards and the full-size modal.
//
// The clinical rule is: WHO percentile curves are sex-specific. The
// chart cannot render without a sex. The slice spec offers a soft
// fallback for legacy patients without `sex` set — infer from the
// first name where the Albanian convention is unambiguous, otherwise
// surface a placeholder asking the doctor to set it inline.

import type { ChartGrowthPointDto } from './patient-client';

export type PatientSexCode = 'm' | 'f';
export type ResolvedSex = PatientSexCode | null;

/** Albanian convention: blue for boys, pink for girls. */
export type GrowthChartTone = 'male' | 'female';

export function toneForSex(sex: PatientSexCode): GrowthChartTone {
  return sex === 'm' ? 'male' : 'female';
}

/** Albanian label shown on the chip alongside the colored chart. */
export function sexChipLabel(sex: PatientSexCode): 'Djalë' | 'Vajzë' {
  return sex === 'm' ? 'Djalë' : 'Vajzë';
}

// =============================================================================
// Name → sex inference (Albanian)
// =============================================================================
//
// Many migrated DonetaMED records lack an explicit `sex` column — the
// Access source didn't always store one. The slice spec asks us to
// infer from the first name when the Albanian convention is
// unambiguous, so the doctor sees the right chart without a manual
// step on every legacy patient.
//
// The two lists below cover the most common Kosovo/Albania first
// names. We deliberately stop short of an exhaustive name database
// — better to surface the "set sex" placeholder than to guess wrong
// on an ambiguous name.

const MALE_NAME_ENDINGS = [
  'on', 'an', 'im', 'en', 'ar', 'as', 'is', 'us',
] as const;

const FEMALE_NAME_ENDINGS = [
  // Albanian feminine endings — most names ending in -e/-a are
  // feminine (Era, Ana, Diellza, Albulena). We list the unambiguous
  // common ones and skip endings that overlap with masculine names.
  'ja', 'ka', 'la', 'na', 'ra', 'sa', 'ta', 'za', 'ana', 'ela',
  'ina', 'ona', 'una', 'eta', 'ita', 'ira', 'ena', 'ura',
] as const;

const KNOWN_MALE_NAMES = new Set([
  'taulant', 'arben', 'arianit', 'arta', 'astrit', 'besnik', 'bujar',
  'driton', 'edon', 'enis', 'ermal', 'fatmir', 'fitim', 'gentian',
  'jeton', 'kushtrim', 'liridon', 'mentor', 'naim', 'rinor',
  'shpend', 'shpëtim', 'shpetim', 'sokol', 'valon', 'visar',
  'arben', 'arber', 'agon', 'altin', 'andi', 'ardit', 'arif', 'arjan',
  'armend', 'artan', 'avni', 'bardh', 'bashkim', 'behar', 'berat',
  'besart', 'besfort', 'besim', 'blendi', 'blerim', 'burim', 'dardan',
  'dion', 'donat', 'durim', 'edmond', 'egzon', 'elvis', 'emir',
  'endrit', 'enver', 'erion', 'fatos', 'fikri', 'florent', 'flutur',
  'fitor', 'gentrit', 'getoar', 'granit', 'guximtar', 'halil', 'hekuran',
  'ibrahim', 'iliriana', 'ilir', 'isuf', 'jakup', 'kreshnik', 'labinot',
  'lirim', 'luan', 'lulëzim', 'lulezim', 'mensur', 'mergim', 'mirjet',
  'muhamet', 'nazim', 'pajtim', 'petrit', 'qamil', 'rrahim', 'rrezart',
  'sami', 'shaban', 'shemsi', 'shkëlzen', 'shkelzen', 'shkumbin',
  'shyqyri', 'skender', 'taulant', 'urim', 'valdrin', 'valmir',
  'vehbi', 'veton', 'xhavit', 'yll', 'ylli', 'zenel', 'zenun',
]);

const KNOWN_FEMALE_NAMES = new Set([
  'era', 'ana', 'mira', 'dafina', 'donika', 'driton', 'edona', 'elira',
  'erleta', 'fjolla', 'flutur', 'jeta', 'lirie', 'luiza', 'mirjeta',
  'rina', 'rita', 'rrita', 'shqipe', 'teuta', 'vlora', 'xhevahire',
  'agnesa', 'albulena', 'alketa', 'altina', 'arberesha', 'arbnora',
  'ardita', 'arjeta', 'arta', 'besa', 'besarta', 'besiana', 'blerta',
  'brikena', 'butrina', 'diana', 'dielle', 'diellza', 'dragana',
  'elena', 'eliza', 'elona', 'emina', 'erblina', 'erza', 'fatime',
  'feride', 'florinda', 'genta', 'hana', 'hanife', 'kaltrina',
  'kosovare', 'leonora', 'lindita', 'liridona', 'liza', 'majlinda',
  'manjola', 'mihrije', 'mimoza', 'mirlinda', 'naile', 'nora', 'olta',
  'rilinda', 'rrezarta', 'sara', 'selvije', 'shqiponja', 'shukrije',
  'shyhrete', 'suzana', 'venera', 'vera', 'vesa', 'vjollca', 'ylberina',
  'yllka', 'zonja',
]);

/**
 * Pick a sex code for the growth chart. Prefer the explicit
 * `patient.sex` column; fall back to first-name inference when the
 * Albanian convention is unambiguous; otherwise return `null` so the
 * UI can prompt the doctor to set it.
 *
 * The function is intentionally conservative — when in doubt we'd
 * rather show the placeholder than render the wrong-sex curves.
 */
export function resolveSex(input: {
  sex: PatientSexCode | null | undefined;
  firstName?: string | null;
}): ResolvedSex {
  if (input.sex === 'm' || input.sex === 'f') return input.sex;
  return inferSexFromFirstName(input.firstName);
}

/**
 * Lower-cost variant used by the unit tests and the rare callers
 * (master strip preview) that have no `patient.sex` available.
 */
export function inferSexFromFirstName(firstName?: string | null): ResolvedSex {
  if (!firstName) return null;
  const normalised = firstName.trim().toLocaleLowerCase('sq-AL');
  if (!normalised) return null;
  // Multi-part first names ("Era Lule") — use the first token.
  const head = normalised.split(/\s+/, 1)[0]!;

  if (KNOWN_MALE_NAMES.has(head)) return 'm';
  if (KNOWN_FEMALE_NAMES.has(head)) return 'f';

  // Endings: female endings are checked first because the female list
  // is more permissive (most -a/-e Albanian names are feminine) but
  // some specific male names end in -a (Andrea, Luka). Those are in
  // the male known-names set and handled above.
  for (const ending of FEMALE_NAME_ENDINGS) {
    if (head.length > ending.length && head.endsWith(ending)) return 'f';
  }
  for (const ending of MALE_NAME_ENDINGS) {
    if (head.length > ending.length && head.endsWith(ending)) return 'm';
  }
  return null;
}

// =============================================================================
// Data-point filtering
// =============================================================================

/** Default WHO band for under-twos. The slice plan pins these. */
export const WHO_MIN_AGE_MONTHS = 0;
export const WHO_MAX_AGE_MONTHS = 24;

export interface GrowthSeries {
  metric: 'weight' | 'length' | 'hc';
  points: Array<{ visitId: string; ageMonths: number; value: number; visitDate: string }>;
}

/**
 * Project a {@link ChartGrowthPointDto} list down to one metric's
 * series, filtered to the standard 0–24 month band by default.
 * Points without a value for the metric are dropped (a visit might
 * record height without weight).
 *
 * When `range = 'all'`, the filter is dropped — used by the modal's
 * "historik 0-24 muaj" view for patients past 24 months who still
 * have infancy data we want to plot retrospectively.
 */
export function pointsForMetric(
  growthPoints: readonly ChartGrowthPointDto[],
  metric: 'weight' | 'length' | 'hc',
  range: 'who' | 'all' = 'who',
): GrowthSeries {
  const series: GrowthSeries = { metric, points: [] };
  for (const p of growthPoints) {
    const v =
      metric === 'weight'
        ? p.weightKg
        : metric === 'length'
          ? p.heightCm
          : p.headCircumferenceCm;
    if (v == null) continue;
    if (range === 'who') {
      if (p.ageMonths < WHO_MIN_AGE_MONTHS) continue;
      if (p.ageMonths > WHO_MAX_AGE_MONTHS) continue;
    }
    series.points.push({
      visitId: p.visitId,
      ageMonths: p.ageMonths,
      value: v,
      visitDate: p.visitDate,
    });
  }
  // Stable ascending sort — most caller flows already deliver oldest
  // first but a hand-crafted fixture might not.
  series.points.sort((a, b) => a.ageMonths - b.ageMonths);
  return series;
}

/**
 * Has the patient outgrown the WHO chart? Mirrors the master-strip
 * "is toddler" gate: ≤ 24 months in (the WHO band) keeps the
 * sparkline cards visible, past it the panel collapses to the
 * "historik" link.
 */
export function isToddlerAge(ageMonths: number | null): boolean {
  if (ageMonths == null) return false;
  return ageMonths <= WHO_MAX_AGE_MONTHS;
}

/**
 * Whole months between two ISO yyyy-mm-dd dates. Used as a fallback
 * when the chart doesn't have a server-computed `ageMonths` (e.g.
 * the master strip's quick toddler check). Calendar-aware so it
 * matches `ageLabelChart` in `patient-client.ts`.
 */
export function ageInMonths(
  dobIso: string | null | undefined,
  asOf: Date = new Date(),
): number | null {
  if (!dobIso) return null;
  const dob = new Date(`${dobIso}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let months =
    (asOf.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - dob.getUTCMonth());
  if (asOf.getUTCDate() < dob.getUTCDate()) months -= 1;
  return Math.max(0, months);
}
