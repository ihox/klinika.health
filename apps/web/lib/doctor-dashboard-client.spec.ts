// Pure-helper tests for the doctor dashboard client.
//
// `formatOpenVisitLabel` is the only branch worth pinning here — the
// other client helpers are exercised through their consumers
// (greeting, daysSinceColor, formatEuros). The label drives the
// "Vizita të hapura" row copy, so any drift in Albanian phrasing is
// loud.

import { describe, expect, it } from 'vitest';

import { formatOpenVisitLabel } from './doctor-dashboard-client';

describe('formatOpenVisitLabel', () => {
  it("uses 'dje' when the backlog is exactly one day old", () => {
    expect(
      formatOpenVisitLabel({ visitDate: '2026-05-15', daysAgo: 1 }),
    ).toBe('15 maj 2026 · dje');
  });

  it('uses "X ditë më parë" for two-or-more day-old entries', () => {
    expect(
      formatOpenVisitLabel({ visitDate: '2026-05-13', daysAgo: 2 }),
    ).toBe('13 maj 2026 · 2 ditë më parë');
    expect(
      formatOpenVisitLabel({ visitDate: '2026-05-01', daysAgo: 15 }),
    ).toBe('1 maj 2026 · 15 ditë më parë');
  });

  it('handles month boundaries and uses the Albanian month name', () => {
    expect(
      formatOpenVisitLabel({ visitDate: '2026-02-28', daysAgo: 77 }),
    ).toBe('28 shkurt 2026 · 77 ditë më parë');
    expect(
      formatOpenVisitLabel({ visitDate: '2025-12-31', daysAgo: 136 }),
    ).toBe('31 dhjetor 2025 · 136 ditë më parë');
  });
});
