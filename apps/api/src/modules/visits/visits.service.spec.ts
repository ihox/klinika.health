// Pure-helper unit tests for the visits service. The diff function is
// the engine behind the audit log's `changes` JSONB array, so we pin
// its behavior here independently of the wider service.

import { describe, expect, it } from 'vitest';

import { computeDiffs } from './visits.service';

describe('computeDiffs', () => {
  it('detects a single-field text change', () => {
    const diffs = computeDiffs(
      { complaint: 'Kollë e thatë' },
      { complaint: 'Kollë e thatë me ethe' },
    );
    expect(diffs).toEqual([
      { field: 'complaint', old: 'Kollë e thatë', new: 'Kollë e thatë me ethe' },
    ]);
  });

  it('treats null and undefined identically (no spurious diff)', () => {
    expect(computeDiffs({ complaint: null }, { complaint: undefined })).toEqual([]);
    expect(computeDiffs({ complaint: undefined }, { complaint: null })).toEqual([]);
  });

  it('emits null → value when a previously-empty field gets a value', () => {
    const diffs = computeDiffs({ weightG: null }, { weightG: 13_600 });
    expect(diffs).toEqual([{ field: 'weightG', old: null, new: 13_600 }]);
  });

  it('emits value → null when a field is cleared', () => {
    const diffs = computeDiffs({ paymentCode: 'A' }, { paymentCode: null });
    expect(diffs).toEqual([{ field: 'paymentCode', old: 'A', new: null }]);
  });

  it('returns an empty array when nothing changed', () => {
    const before = { complaint: 'x', weightG: 100, feedingBreast: true };
    const after = { ...before };
    expect(computeDiffs(before, after)).toEqual([]);
  });

  it('handles multiple simultaneous changes (ordered by TRACKED_FIELDS)', () => {
    const diffs = computeDiffs(
      { complaint: 'a', weightG: 10, feedingBreast: false },
      { complaint: 'b', weightG: 20, feedingBreast: true },
    );
    expect(diffs.map((d) => d.field)).toEqual([
      'complaint',
      'feedingBreast',
      'weightG',
    ]);
  });

  it('compares Date instances by their iso-day form', () => {
    const before = { visitDate: new Date('2026-05-14T00:00:00Z') };
    const after = { visitDate: new Date('2026-05-15T00:00:00Z') };
    const diffs = computeDiffs(before, after);
    expect(diffs).toEqual([
      { field: 'visitDate', old: '2026-05-14', new: '2026-05-15' },
    ]);
  });

  it('treats Prisma Decimal-like objects via toString', () => {
    const before = { heightCm: { toString: () => '92.00' } };
    const after = { heightCm: { toString: () => '95.00' } };
    const diffs = computeDiffs(before, after);
    expect(diffs).toEqual([
      { field: 'heightCm', old: '92.00', new: '95.00' },
    ]);
  });

  it('ignores fields outside TRACKED_FIELDS (e.g. updatedBy, deletedAt)', () => {
    const before = { complaint: 'x', updatedBy: 'u-1', deletedAt: null };
    const after = { complaint: 'x', updatedBy: 'u-2', deletedAt: new Date() };
    expect(computeDiffs(before, after)).toEqual([]);
  });

  it('treats empty strings as null (auto-save sends "" when a textarea is blanked)', () => {
    expect(computeDiffs({ complaint: 'x' }, { complaint: '' })).toEqual([
      { field: 'complaint', old: 'x', new: null },
    ]);
    expect(computeDiffs({ complaint: '' }, { complaint: null })).toEqual([]);
  });
});
