// Unit tests for the dicom-picker pure helpers. The dialog itself
// renders in the chart E2E (`tests/e2e/dicom.spec.ts`), which
// exercises click → API → link flow with mocks.

import { describe, expect, it } from 'vitest';

import {
  formatDateTime,
  formatDdMmYyyy,
  relativeWhenLabel,
} from './dicom-picker-dialog';

describe('formatDdMmYyyy', () => {
  it('reformats ISO date to dd.MM.yyyy', () => {
    expect(formatDdMmYyyy('2026-05-14')).toBe('14.05.2026');
  });

  it('truncates a full ISO timestamp to its date part', () => {
    expect(formatDdMmYyyy('2026-05-14T11:42:00.000Z')).toBe('14.05.2026');
  });

  it('returns the input when malformed', () => {
    expect(formatDdMmYyyy('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateTime', () => {
  it('emits dd.MM.yyyy · HH:mm in Europe/Belgrade', () => {
    // 2026-05-14T09:42Z = 11:42 in Belgrade (CEST, UTC+2)
    expect(formatDateTime('2026-05-14T09:42:00.000Z')).toBe('14.05.2026 · 11:42');
  });

  it('falls back to the input when unparseable', () => {
    expect(formatDateTime('garbage')).toBe('garbage');
  });
});

describe('relativeWhenLabel', () => {
  it('returns "para pak çastesh" within the same minute', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');
    const recent = new Date('2026-05-14T11:59:45.000Z').toISOString();
    expect(relativeWhenLabel(recent, now)).toBe('para pak çastesh');
  });

  it('returns "para N min" for under an hour', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');
    const t = new Date('2026-05-14T11:55:00.000Z').toISOString();
    expect(relativeWhenLabel(t, now)).toBe('para 5 min');
  });

  it('returns "para 1 orë" for over 60 min', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');
    const t = new Date('2026-05-14T10:50:00.000Z').toISOString();
    expect(relativeWhenLabel(t, now)).toBe('para 1 orë');
  });

  it('returns null when older than 2h (absolute date carries meaning)', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');
    const t = new Date('2026-05-14T08:00:00.000Z').toISOString();
    expect(relativeWhenLabel(t, now)).toBeNull();
  });

  it('returns null for future timestamps', () => {
    const now = new Date('2026-05-14T12:00:00.000Z');
    const t = new Date('2026-05-14T13:00:00.000Z').toISOString();
    expect(relativeWhenLabel(t, now)).toBeNull();
  });
});
