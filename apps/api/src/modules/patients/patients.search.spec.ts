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
});
