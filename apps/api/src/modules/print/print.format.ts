// Pure formatting helpers used by the print templates.
//
// All functions are pure (deterministic from inputs, no I/O) so the
// template-rendering tests can pin output without spinning up Puppeteer.
//
// The conventions follow the design-reference prototype:
//   * Dates → "dd.MM.yyyy" with tabular numerals
//   * Weights → "13.6 kg" / "3 280 g" (thin space thousands separator)
//   * Heights → "92 cm" / "12.4 cm" (decimal where measured)
//   * Temperatures → "37.2 °C"
//
// Albanian locale: comma decimal separator is NOT used — clinical
// values stay dot-decimal to match the chart UI. The thin space
// thousands separator matches the prototype's "3 280 g" rendering.

const THIN_SPACE = ' ';

export function formatIsoDateDdMmYyyy(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

export function formatIsoDateDdMmYy(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y.slice(2)}`;
}

export function formatWeightG(weightG: number | null | undefined): string {
  if (weightG == null || !Number.isFinite(weightG)) return '—';
  return `${insertThousands(weightG)}${THIN_SPACE}g`;
}

/**
 * Weight in kilograms, one decimal, no trailing zero. Used on the
 * visit-report vitals strip and on the history table.
 */
export function formatWeightKg(weightKg: number | null | undefined): string {
  if (weightKg == null || !Number.isFinite(weightKg)) return '—';
  const rounded = Math.round(weightKg * 10) / 10;
  return `${rounded.toFixed(1)} kg`;
}

export function formatLengthCm(cm: number | null | undefined): string {
  if (cm == null || !Number.isFinite(cm)) return '—';
  // Whole-number heights (92, 51) drop the decimal; measured
  // (head circumference 48.2) keep one.
  const rounded = Math.round(cm * 10) / 10;
  if (Number.isInteger(rounded)) {
    return `${rounded} cm`;
  }
  return `${rounded.toFixed(1)} cm`;
}

export function formatTemperatureC(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return '—';
  return `${(Math.round(c * 10) / 10).toFixed(1)} °C`;
}

/**
 * Albanian pediatric age label used on the patient banner.
 * `2 vjeç 9 muaj` / `4 muaj` / `12 ditë`. Returns '' when DOB is null.
 */
export function ageLabelLong(
  dobIso: string | null,
  asOfIso: string,
): string {
  if (!dobIso) return '';
  const dob = parseIsoDate(dobIso);
  const asOf = parseIsoDate(asOfIso);
  if (!dob || !asOf) return '';
  const days = Math.floor((asOf.getTime() - dob.getTime()) / 86_400_000);
  if (days < 0) return '';
  if (days < 60) return `${days} ditë`;
  const months =
    (asOf.getUTCFullYear() - dob.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - dob.getUTCMonth()) -
    (asOf.getUTCDate() < dob.getUTCDate() ? 1 : 0);
  // < 12 months → "N muaj". 12–23 months collapse into "1 vit"
  // (months 12) or "1 vit N muaj" (months 13–23) so the printed
  // banner matches the chart UI's `ageLabel` (12 months = "1v").
  if (months < 12) return `${months} muaj`;
  const years = Math.floor(months / 12);
  const rem = months - years * 12;
  if (rem === 0) {
    return `${years} ${years === 1 ? 'vit' : 'vjeç'}`;
  }
  return `${years} ${years === 1 ? 'vit' : 'vjeç'} ${rem} muaj`;
}

export function sexLabel(sex: 'm' | 'f' | null): string {
  if (sex === 'm') return 'djalë';
  if (sex === 'f') return 'vajzë';
  return '';
}

export function ageLine(
  dobIso: string | null,
  sex: 'm' | 'f' | null,
  asOfIso: string,
): string {
  const age = ageLabelLong(dobIso, asOfIso);
  const s = sexLabel(sex);
  if (age && s) return `${s} · ${age}`;
  return age || s;
}

export function hoursLineFromConfig(
  hoursConfig: unknown,
  fallback = '10:00 – 18:00',
): string {
  // The seed stores Mon-Fri 10:00–18:00 + Sat 10:00–14:00. The print
  // letterhead uses the weekday line — Sat is implicit. Defensive:
  // if the structure isn't the expected shape, fall back to the
  // CLAUDE.md §14 default rather than rendering "".
  if (hoursConfig && typeof hoursConfig === 'object') {
    const days = (hoursConfig as { days?: Record<string, { open?: boolean; start?: string; end?: string }> }).days;
    const mon = days?.['mon'];
    if (mon?.open && mon.start && mon.end) {
      return `${mon.start} – ${mon.end}`;
    }
  }
  return fallback;
}

export function formatPatientIdLabel(legacyId: number | null, uuid: string): string {
  if (legacyId != null) return `PT-${String(legacyId).padStart(5, '0')}`;
  // For new patients (no legacy id), use an 8-char slug from the
  // UUID — enough to be unique within a clinic without printing the
  // full UUID, and a familiar shape for paper records.
  return `PT-${uuid.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

export function formatCertificateNumber(issuedAt: Date, sequenceWithinYear: number): string {
  // VM = Vërtetim Mjekësor. Format parallels V-YYYY-NNNN (visit) and
  // PT-NNNNN (patient) so the three serial schemes read as one
  // family of paper records. Year anchored on UTC for stability
  // across DST transitions in Europe/Belgrade.
  const year = issuedAt.getUTCFullYear();
  return `VM-${year}-${String(sequenceWithinYear).padStart(4, '0')}`;
}

function insertThousands(n: number): string {
  // Thin-space grouping matches the prototype's "3 280 g".
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(Math.round(n));
  return sign + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

function parseIsoDate(iso: string): Date | null {
  // Anchor at UTC midnight so "days between" arithmetic isn't moved
  // by the host timezone — every clinical date is calendar-anchored.
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Compute the inclusive day-count for a vërtetim period.
 *
 *   2026-05-14 → 2026-05-14  ⇒ 1 ditë (same day)
 *   2026-05-14 → 2026-05-18  ⇒ 5 ditë
 *   2026-05-14 → 2026-05-13  ⇒ throws (invalid range, validated at boundary)
 *
 * Mirrors `patient-chart.service.ts#daysInclusive` so the chart
 * panel and the printed document agree on duration. Kept here as a
 * separate (identical) copy so the print module is import-free of
 * the patients module.
 */
export function vertetimDaysInclusive(fromIso: string, toIso: string): number {
  const f = parseIsoDate(fromIso);
  const t = parseIsoDate(toIso);
  if (!f || !t) throw new Error('Data e pavlefshme');
  if (t.getTime() < f.getTime()) {
    throw new Error('Periudhë e pavlefshme: "Deri" duhet të jetë >= "Nga".');
  }
  return Math.floor((t.getTime() - f.getTime()) / 86_400_000) + 1;
}

/**
 * Returns true when a string is non-null and has at least one
 * non-whitespace character. Templates use it to decide whether to
 * render a clinical box at all (skipping an empty Th section).
 */
export function hasText(value: string | null | undefined): value is string {
  return !!value && value.trim().length > 0;
}

/**
 * HTML-escape for template substitution. Print templates concatenate
 * strings rather than using a templating engine, so this is the only
 * defense against accidental tag injection from clinical text.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (value == null) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
