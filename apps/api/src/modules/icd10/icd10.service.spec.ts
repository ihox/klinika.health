// Pure-ranking unit tests for the ICD-10 search.
//
// The actual SQL query happens in `Icd10Service.search`; this file
// pins the ordering rules via {@link rankSearchResults}, which is the
// same logic implemented as a pure function so it can be exercised
// without Postgres.

import { describe, expect, it } from 'vitest';

import {
  FREQUENT_TOP_N,
  rankSearchResults,
} from './icd10.service';

const CATALOGUE = [
  { code: 'J00', latinDescription: 'Rhinitis acuta', chapter: 'Respiratory', common: true },
  { code: 'J03.9', latinDescription: 'Tonsillitis acuta', chapter: 'Respiratory', common: true },
  { code: 'J20.9', latinDescription: 'Bronchitis acuta', chapter: 'Respiratory', common: true },
  { code: 'J21.0', latinDescription: 'Bronchiolitis acuta', chapter: 'Respiratory', common: true },
  { code: 'J42', latinDescription: 'Bronchitis chronica', chapter: 'Respiratory', common: false },
  { code: 'J45.9', latinDescription: 'Asthma bronchiale', chapter: 'Respiratory', common: true },
  { code: 'R05', latinDescription: 'Tussis', chapter: 'Symptoms', common: true },
  { code: 'R50.9', latinDescription: 'Febris', chapter: 'Symptoms', common: true },
];

describe('rankSearchResults', () => {
  it('returns common codes first when q is empty', () => {
    const out = rankSearchResults({
      q: '',
      limit: 20,
      catalogue: CATALOGUE,
      usage: [],
    });
    // No usage → no frequent boost, all common codes alphabetically.
    expect(out[0]!.frequentlyUsed).toBe(false);
    expect(out.map((r) => r.code)).toEqual([
      'J00',
      'J03.9',
      'J20.9',
      'J21.0',
      'J45.9',
      'R05',
      'R50.9',
    ]);
  });

  it('boosts the doctor\'s recently-used codes ahead of alphabetical matches', () => {
    const out = rankSearchResults({
      q: 'bron',
      limit: 20,
      catalogue: CATALOGUE,
      usage: [
        { icd10Code: 'J45.9', useCount: 14, lastUsedAt: new Date('2026-05-13') },
        { icd10Code: 'J20.9', useCount: 3, lastUsedAt: new Date('2026-05-14') },
      ],
    });
    // J45.9 has higher useCount; J20.9 second; then alphabetical J21.0, J42.
    expect(out.map((r) => r.code)).toEqual(['J45.9', 'J20.9', 'J21.0', 'J42']);
    expect(out[0]!.frequentlyUsed).toBe(true);
    expect(out[1]!.frequentlyUsed).toBe(true);
    expect(out[2]!.frequentlyUsed).toBe(false);
  });

  it('caps the frequent-used boost at FREQUENT_TOP_N', () => {
    const usage = Array.from({ length: 10 }, (_, i) => ({
      icd10Code: ['J00', 'J03.9', 'J20.9', 'J21.0', 'J42', 'J45.9', 'R05', 'R50.9'][i % 8]!,
      useCount: 100 - i,
      lastUsedAt: new Date(`2026-05-${i + 1}`),
    }));
    const out = rankSearchResults({ q: '', limit: 20, catalogue: CATALOGUE, usage });
    const boosted = out.filter((r) => r.frequentlyUsed);
    expect(boosted.length).toBeLessThanOrEqual(FREQUENT_TOP_N);
  });

  it('matches case-insensitively on code prefix', () => {
    const out = rankSearchResults({
      q: 'j',
      limit: 20,
      catalogue: CATALOGUE,
      usage: [],
    });
    expect(out.every((r) => r.code.startsWith('J'))).toBe(true);
  });

  it('matches description substring (case-insensitive)', () => {
    const out = rankSearchResults({
      q: 'TUSS',
      limit: 20,
      catalogue: CATALOGUE,
      usage: [],
    });
    expect(out.map((r) => r.code)).toEqual(['R05']);
  });

  it('respects the limit when frequent + catalogue exceed it', () => {
    const out = rankSearchResults({
      q: '',
      limit: 3,
      catalogue: CATALOGUE,
      usage: [
        { icd10Code: 'J45.9', useCount: 10, lastUsedAt: new Date('2026-05-14') },
      ],
    });
    expect(out.length).toBe(3);
    expect(out[0]!.code).toBe('J45.9');
  });

  it('does not duplicate codes between the frequent and catalogue tiers', () => {
    const out = rankSearchResults({
      q: 'J',
      limit: 20,
      catalogue: CATALOGUE,
      usage: [
        { icd10Code: 'J45.9', useCount: 10, lastUsedAt: new Date('2026-05-14') },
      ],
    });
    const codes = out.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
