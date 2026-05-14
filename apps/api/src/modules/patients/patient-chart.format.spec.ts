// Unit tests for the chart age + indicator-color helpers. The web's
// `patient-client.ts` keeps a byte-identical mirror of these — both
// must agree, so we pin the contract here.

import { describe, expect, it } from 'vitest';

import { ageLabelChart, daysSinceVisitColor } from './patient-chart.format';

describe('ageLabelChart', () => {
  // The chart's master strip wants the dense form ("2v 3m" / "11m"
  // / "1v") — different from the verbose `ageLabel` used in the
  // doctor browser ("11 muaj").

  it('returns empty string when the dob is null', () => {
    expect(ageLabelChart(null)).toBe('');
  });

  it('returns empty string when the dob is malformed', () => {
    expect(ageLabelChart('not-a-date')).toBe('');
  });

  it('renders newborn ages in days for the first 60 days', () => {
    const asOf = new Date('2026-05-14T12:00:00Z');
    expect(ageLabelChart('2026-05-12', asOf)).toBe('2 ditë');
    expect(ageLabelChart('2026-04-15', asOf)).toBe('29 ditë');
  });

  it('renders months as "Nm" between 2 and 11 months', () => {
    const asOf = new Date('2026-05-14T12:00:00Z');
    expect(ageLabelChart('2026-02-14', asOf)).toBe('3m');
    expect(ageLabelChart('2025-06-14', asOf)).toBe('11m');
  });

  it('renders "1v" exactly at the 12-month mark', () => {
    const asOf = new Date('2026-05-14T12:00:00Z');
    expect(ageLabelChart('2025-05-14', asOf)).toBe('1v');
  });

  it('renders "Yv Xm" for ages with non-zero remaining months', () => {
    const asOf = new Date('2026-05-14T12:00:00Z');
    expect(ageLabelChart('2023-08-03', asOf)).toBe('2v 9m');
    expect(ageLabelChart('2024-02-12', asOf)).toBe('2v 3m');
  });

  it('renders "Yv" exactly on the birthday', () => {
    const asOf = new Date('2026-05-14T12:00:00Z');
    expect(ageLabelChart('2024-05-14', asOf)).toBe('2v');
    expect(ageLabelChart('2019-05-14', asOf)).toBe('7v');
  });

  it('returns empty for future birthdays (defensive)', () => {
    const asOf = new Date('2026-05-14T12:00:00Z');
    expect(ageLabelChart('2030-01-01', asOf)).toBe('');
  });
});

describe('daysSinceVisitColor', () => {
  it('returns green when no prior visit', () => {
    expect(daysSinceVisitColor(null)).toBe('green');
  });

  it('returns green for a same-day visit (days === 0)', () => {
    expect(daysSinceVisitColor(0)).toBe('green');
  });

  it('returns red for 1–7 days', () => {
    expect(daysSinceVisitColor(1)).toBe('red');
    expect(daysSinceVisitColor(5)).toBe('red');
    expect(daysSinceVisitColor(7)).toBe('red');
  });

  it('returns amber for 8–30 days', () => {
    expect(daysSinceVisitColor(8)).toBe('amber');
    expect(daysSinceVisitColor(15)).toBe('amber');
    expect(daysSinceVisitColor(30)).toBe('amber');
  });

  it('returns green beyond 30 days', () => {
    expect(daysSinceVisitColor(31)).toBe('green');
    expect(daysSinceVisitColor(180)).toBe('green');
  });
});
