// Unit tests for the search-term parser. The fuzzy SQL itself runs
// in `patients.integration.spec.ts` (live Postgres + pg_trgm); here we
// pin the token classifier so we don't accidentally re-route "2024"
// as a name or a legacy_id.

import { describe, expect, it } from 'vitest';

import { parseSearchTerm } from './patients.service';

describe('parseSearchTerm', () => {
  it('classifies a 4-digit number as a DOB year', () => {
    const out = parseSearchTerm('2024');
    expect(out.year).toBe(2024);
    expect(out.nameTokens).toEqual([]);
    expect(out.legacyId).toBeNull();
  });

  it('keeps the most recent token as a year ahead of legacy_id heuristics', () => {
    // Tie-break: 1999 is in the year range, so we read it as a year.
    const out = parseSearchTerm('1999');
    expect(out.year).toBe(1999);
    expect(out.legacyId).toBeNull();
  });

  it('classifies a "#"-prefixed integer as a legacy_id', () => {
    const out = parseSearchTerm('#4829');
    expect(out.legacyId).toBe(4829);
    expect(out.year).toBeNull();
  });

  it('classifies a bare 1-3 digit integer as a legacy_id', () => {
    const out = parseSearchTerm('487');
    expect(out.legacyId).toBe(487);
    expect(out.year).toBeNull();
  });

  it('combined "Hoxha 2024" splits into name + year', () => {
    const out = parseSearchTerm('Hoxha 2024');
    expect(out.nameTokens).toEqual(['Hoxha']);
    expect(out.year).toBe(2024);
  });

  it('handles multiple name tokens', () => {
    const out = parseSearchTerm('  Era   Krasniqi  ');
    expect(out.nameTokens).toEqual(['Era', 'Krasniqi']);
  });

  it('keeps the legacy_id and ignores junk', () => {
    const out = parseSearchTerm('Hoxha #4829 Rita');
    expect(out.legacyId).toBe(4829);
    expect(out.nameTokens.sort()).toEqual(['Hoxha', 'Rita']);
  });

  it('returns empty fields for an empty string', () => {
    const out = parseSearchTerm('');
    expect(out.nameTokens).toEqual([]);
    expect(out.year).toBeNull();
    expect(out.legacyId).toBeNull();
  });

  it('treats out-of-range "years" (e.g. 3024) as name tokens', () => {
    const out = parseSearchTerm('3024');
    // Out of [1900,2100] year range — not a year.
    expect(out.year).toBeNull();
    // 4 digits still > 7 digits ceiling for legacy_id? No — `#?\d{1,7}` matches.
    expect(out.legacyId).toBe(3024);
  });

  // --------------------------------------------------------------------
  // Full DOB token (DD.MM.YYYY / DD/MM/YYYY / DD-MM-YYYY)
  // --------------------------------------------------------------------

  it('classifies "12.02.2024" as a full DOB (dot separator)', () => {
    const out = parseSearchTerm('12.02.2024');
    expect(out.dobFull).toBe('2024-02-12');
    expect(out.nameTokens).toEqual([]);
    expect(out.year).toBeNull();
    expect(out.legacyId).toBeNull();
  });

  it('accepts slash separator "12/02/2024"', () => {
    expect(parseSearchTerm('12/02/2024').dobFull).toBe('2024-02-12');
  });

  it('accepts dash separator "12-02-2024"', () => {
    expect(parseSearchTerm('12-02-2024').dobFull).toBe('2024-02-12');
  });

  it('pads single-digit day/month to zero-padded ISO', () => {
    expect(parseSearchTerm('1.2.2024').dobFull).toBe('2024-02-01');
    expect(parseSearchTerm('1/2/2024').dobFull).toBe('2024-02-01');
  });

  it('combined "Hoxha 12.02.2024" splits into name + dobFull', () => {
    const out = parseSearchTerm('Hoxha 12.02.2024');
    expect(out.nameTokens).toEqual(['Hoxha']);
    expect(out.dobFull).toBe('2024-02-12');
    expect(out.year).toBeNull();
  });

  // Invalid date-shaped tokens fall through to nameTokens — that way
  // a half-typed query and an impossible date both produce the same
  // "no DOB match" UX, and a mistyped Feb 30 in a "Hoxha 30.02" query
  // doesn't silently turn into a name-only search.
  it('falls through "30.02.2024" to nameTokens (Feb 30 invalid)', () => {
    const out = parseSearchTerm('30.02.2024');
    expect(out.dobFull).toBeNull();
    expect(out.nameTokens).toEqual(['30.02.2024']);
  });

  it('falls through "31.04.2024" to nameTokens (April has 30 days)', () => {
    const out = parseSearchTerm('31.04.2024');
    expect(out.dobFull).toBeNull();
    expect(out.nameTokens).toEqual(['31.04.2024']);
  });

  it('falls through out-of-range year "12.02.1800" to nameTokens', () => {
    const out = parseSearchTerm('12.02.1800');
    expect(out.dobFull).toBeNull();
    expect(out.nameTokens).toEqual(['12.02.1800']);
  });

  it('does NOT consume bare 4-digit "2024" as a DOB (still a year)', () => {
    const out = parseSearchTerm('2024');
    expect(out.dobFull).toBeNull();
    expect(out.year).toBe(2024);
  });

  it('leap day "29.02.2020" parses (2020 is a leap year)', () => {
    expect(parseSearchTerm('29.02.2020').dobFull).toBe('2020-02-29');
  });

  it('non-leap "29.02.2021" falls through to nameTokens', () => {
    const out = parseSearchTerm('29.02.2021');
    expect(out.dobFull).toBeNull();
    expect(out.nameTokens).toEqual(['29.02.2021']);
  });

  // --------------------------------------------------------------------
  // Partial DOB — day + month (DD.MM)
  // --------------------------------------------------------------------

  it('classifies "12.02" as day+month (any year)', () => {
    const out = parseSearchTerm('12.02');
    expect(out.dobDayMonth).toEqual({ day: 12, month: 2 });
    expect(out.dobDayMonthYearPrefix).toBeNull();
    expect(out.dobFull).toBeNull();
    expect(out.nameTokens).toEqual([]);
  });

  it('day+month accepts slash and dash separators', () => {
    expect(parseSearchTerm('12/02').dobDayMonth).toEqual({ day: 12, month: 2 });
    expect(parseSearchTerm('12-02').dobDayMonth).toEqual({ day: 12, month: 2 });
  });

  it('day+month accepts single-digit "1.2"', () => {
    expect(parseSearchTerm('1.2').dobDayMonth).toEqual({ day: 1, month: 2 });
  });

  it('falls through impossible "30.02" to nameTokens (Feb has at most 29)', () => {
    const out = parseSearchTerm('30.02');
    expect(out.dobDayMonth).toBeNull();
    expect(out.nameTokens).toEqual(['30.02']);
  });

  it('falls through "31.04" to nameTokens (April has 30)', () => {
    const out = parseSearchTerm('31.04');
    expect(out.dobDayMonth).toBeNull();
    expect(out.nameTokens).toEqual(['31.04']);
  });

  it('falls through month > 12 "12.13" to nameTokens', () => {
    const out = parseSearchTerm('12.13');
    expect(out.dobDayMonth).toBeNull();
    expect(out.nameTokens).toEqual(['12.13']);
  });

  it('day+month accepts Feb 29 (matches leap-year births)', () => {
    expect(parseSearchTerm('29.02').dobDayMonth).toEqual({ day: 29, month: 2 });
  });

  // --------------------------------------------------------------------
  // Partial DOB — day + month + year prefix (DD.MM.Y / .YY / .YYY)
  // --------------------------------------------------------------------

  it('classifies "12.02.2" as day+month+year-prefix (1-digit prefix)', () => {
    const out = parseSearchTerm('12.02.2');
    expect(out.dobDayMonthYearPrefix).toEqual({ day: 12, month: 2, yearPrefix: '2' });
    expect(out.dobDayMonth).toBeNull();
    expect(out.dobFull).toBeNull();
  });

  it('classifies "12.02.20" as day+month+year-prefix (2-digit prefix)', () => {
    expect(parseSearchTerm('12.02.20').dobDayMonthYearPrefix).toEqual({
      day: 12,
      month: 2,
      yearPrefix: '20',
    });
  });

  it('classifies "12.02.202" as day+month+year-prefix (3-digit prefix)', () => {
    expect(parseSearchTerm('12.02.202').dobDayMonthYearPrefix).toEqual({
      day: 12,
      month: 2,
      yearPrefix: '202',
    });
  });

  it('year-prefix accepts slash and dash separators', () => {
    expect(parseSearchTerm('12/02/20').dobDayMonthYearPrefix).toEqual({
      day: 12,
      month: 2,
      yearPrefix: '20',
    });
    expect(parseSearchTerm('12-02-20').dobDayMonthYearPrefix).toEqual({
      day: 12,
      month: 2,
      yearPrefix: '20',
    });
  });

  it('falls through "30.02.20" to nameTokens (Feb 30 invalid even with year prefix)', () => {
    const out = parseSearchTerm('30.02.20');
    expect(out.dobDayMonthYearPrefix).toBeNull();
    expect(out.nameTokens).toEqual(['30.02.20']);
  });

  it('falls through "13.13.20" to nameTokens (month > 12)', () => {
    const out = parseSearchTerm('13.13.20');
    expect(out.dobDayMonthYearPrefix).toBeNull();
    expect(out.nameTokens).toEqual(['13.13.20']);
  });

  // --------------------------------------------------------------------
  // Disambiguation across DOB tiers
  // --------------------------------------------------------------------

  it('full DOB "12.02.2024" wins over partial tiers (4-digit year)', () => {
    const out = parseSearchTerm('12.02.2024');
    expect(out.dobFull).toBe('2024-02-12');
    expect(out.dobDayMonth).toBeNull();
    expect(out.dobDayMonthYearPrefix).toBeNull();
  });

  it('"12.2024" (no leading day) is not a DOB pattern — falls to nameTokens', () => {
    const out = parseSearchTerm('12.2024');
    expect(out.dobDayMonth).toBeNull();
    expect(out.dobDayMonthYearPrefix).toBeNull();
    expect(out.dobFull).toBeNull();
    expect(out.nameTokens).toEqual(['12.2024']);
  });

  it('bare 4-digit "2024" stays a year', () => {
    const out = parseSearchTerm('2024');
    expect(out.year).toBe(2024);
    expect(out.dobDayMonthYearPrefix).toBeNull();
  });

  it('bare "12" stays a legacy_id (not day+month)', () => {
    const out = parseSearchTerm('12');
    expect(out.legacyId).toBe(12);
    expect(out.dobDayMonth).toBeNull();
  });

  it('combined "Hoxha 12.02" splits into name + dobDayMonth', () => {
    const out = parseSearchTerm('Hoxha 12.02');
    expect(out.nameTokens).toEqual(['Hoxha']);
    expect(out.dobDayMonth).toEqual({ day: 12, month: 2 });
  });

  it('combined "Hoxha 12.02.20" splits into name + dobDayMonthYearPrefix', () => {
    const out = parseSearchTerm('Hoxha 12.02.20');
    expect(out.nameTokens).toEqual(['Hoxha']);
    expect(out.dobDayMonthYearPrefix).toEqual({
      day: 12,
      month: 2,
      yearPrefix: '20',
    });
  });

  // --------------------------------------------------------------------
  // Trailing-separator tolerance (mid-typing UX)
  // --------------------------------------------------------------------

  it('trailing dot on "12.02." still parses as day+month', () => {
    expect(parseSearchTerm('12.02.').dobDayMonth).toEqual({ day: 12, month: 2 });
  });

  it('trailing dot on "12.02.20." still parses as year-prefix', () => {
    expect(parseSearchTerm('12.02.20.').dobDayMonthYearPrefix).toEqual({
      day: 12,
      month: 2,
      yearPrefix: '20',
    });
  });

  it('trailing dot on "12.02.2024." still parses as full DOB', () => {
    expect(parseSearchTerm('12.02.2024.').dobFull).toBe('2024-02-12');
  });

  it('trailing dot on "2024." still parses as year', () => {
    expect(parseSearchTerm('2024.').year).toBe(2024);
  });

  it('combined "Hoxha 12.02." splits into name + day+month', () => {
    const out = parseSearchTerm('Hoxha 12.02.');
    expect(out.nameTokens).toEqual(['Hoxha']);
    expect(out.dobDayMonth).toEqual({ day: 12, month: 2 });
  });

  it('repeated trailing dots "12.02..." also normalize to day+month', () => {
    expect(parseSearchTerm('12.02...').dobDayMonth).toEqual({ day: 12, month: 2 });
  });

  it('mixed trailing separators "12-02-/" also normalize', () => {
    expect(parseSearchTerm('12-02-/').dobDayMonth).toEqual({ day: 12, month: 2 });
  });

  it('LEADING separator ".12.02" does NOT auto-correct (falls to name)', () => {
    const out = parseSearchTerm('.12.02');
    expect(out.dobDayMonth).toBeNull();
    expect(out.dobDayMonthYearPrefix).toBeNull();
    expect(out.nameTokens).toEqual(['.12.02']);
  });
});
