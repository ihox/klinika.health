// Unit tests for the daily-summary aggregation + range guard.
//
// These run in any environment — no DB, no Nest. The integration
// spec (visits-daily-summary.integration.spec.ts) covers the
// controller surface and the receptionist 403.

import { describe, expect, it } from 'vitest';

import {
  aggregate,
  isWithinReceptionistRange,
  parsePaymentCodes,
  paymentCodeCatalogue,
  previousDay,
} from './visits-daily-summary.service';
import type { DailySummaryVisitDto } from './visits-daily-summary.dto';

const DEFAULT_CODES = {
  A: { label: 'Vizitë standarde', amountCents: 1500 },
  B: { label: 'Vizitë e shkurtër', amountCents: 1000 },
  C: { label: 'Kontroll', amountCents: 500 },
  D: { label: 'Vizitë e gjatë', amountCents: 2000 },
  E: { label: 'Falas', amountCents: 0 },
};

function visit(
  status: DailySummaryVisitDto['status'],
  paymentCode: DailySummaryVisitDto['paymentCode'] = null,
  paymentAmountCents: number | null = null,
  partial: Partial<DailySummaryVisitDto> = {},
): DailySummaryVisitDto {
  return {
    id: partial.id ?? cryptoId(),
    time: partial.time ?? '10:00',
    patient: partial.patient ?? {
      id: cryptoId(),
      firstName: 'Era',
      lastName: 'Krasniqi',
      dateOfBirth: '2018-04-12',
    },
    status,
    isWalkIn: partial.isWalkIn ?? false,
    paymentCode,
    paymentAmountCents,
    isFirstVisit: partial.isFirstVisit ?? false,
  };
}

let counter = 0;
function cryptoId(): string {
  counter += 1;
  return `00000000-0000-0000-0000-${counter.toString(10).padStart(12, '0')}`;
}

describe('previousDay', () => {
  it('steps back one local day', () => {
    expect(previousDay('2026-05-22')).toBe('2026-05-21');
  });
  it('crosses month boundary', () => {
    expect(previousDay('2026-06-01')).toBe('2026-05-31');
  });
  it('crosses year boundary', () => {
    expect(previousDay('2027-01-01')).toBe('2026-12-31');
  });
});

describe('isWithinReceptionistRange', () => {
  it('accepts today', () => {
    expect(isWithinReceptionistRange('2026-05-22', '2026-05-22')).toBe(true);
  });
  it('accepts yesterday', () => {
    expect(isWithinReceptionistRange('2026-05-21', '2026-05-22')).toBe(true);
  });
  it('rejects two days ago', () => {
    expect(isWithinReceptionistRange('2026-05-20', '2026-05-22')).toBe(false);
  });
  it('rejects tomorrow', () => {
    expect(isWithinReceptionistRange('2026-05-23', '2026-05-22')).toBe(false);
  });
  it('rejects far past', () => {
    expect(isWithinReceptionistRange('2025-01-01', '2026-05-22')).toBe(false);
  });
});

describe('parsePaymentCodes', () => {
  it('returns empty for null / non-object', () => {
    expect(parsePaymentCodes(null)).toEqual({});
    expect(parsePaymentCodes(undefined)).toEqual({});
    expect(parsePaymentCodes('A')).toEqual({});
    expect(parsePaymentCodes(42)).toEqual({});
  });
  it('parses well-formed JSON', () => {
    const out = parsePaymentCodes({
      A: { label: 'Standard', amountCents: 1500 },
      E: { label: 'Falas', amountCents: 0 },
    });
    expect(out).toEqual({
      A: { label: 'Standard', amountCents: 1500 },
      E: { label: 'Falas', amountCents: 0 },
    });
  });
  it('defaults missing fields', () => {
    const out = parsePaymentCodes({ A: {} });
    expect(out.A).toEqual({ label: '', amountCents: 0 });
  });
});

describe('paymentCodeCatalogue', () => {
  it('orders A→E', () => {
    const catalogue = paymentCodeCatalogue(DEFAULT_CODES);
    expect(catalogue.map((c) => c.code)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });
  it('omits codes the clinic didn\'t configure', () => {
    const catalogue = paymentCodeCatalogue({
      A: DEFAULT_CODES.A,
      E: DEFAULT_CODES.E,
    });
    expect(catalogue.map((c) => c.code)).toEqual(['A', 'E']);
  });
});

describe('aggregate', () => {
  it('sums only completed visits with codes', () => {
    const visits = [
      visit('completed', 'A', 1500),
      visit('completed', 'B', 1000),
      visit('completed', 'A', 1500),
      visit('no_show', null, null),
      visit('scheduled', null, null),
    ];
    const out = aggregate(visits, DEFAULT_CODES);
    expect(out.totalRevenueCents).toBe(4000);
    expect(out.paidCount).toBe(3);
  });

  it('excludes E (Falas) from paidCount but counts the visit in completed', () => {
    const visits = [
      visit('completed', 'A', 1500),
      visit('completed', 'E', 0),
    ];
    const out = aggregate(visits, DEFAULT_CODES);
    expect(out.totalRevenueCents).toBe(1500);
    expect(out.paidCount).toBe(1);
    expect(out.statusBreakdown.completed).toBe(2);
  });

  it('counts statuses across the full lifecycle', () => {
    const visits = [
      visit('scheduled'),
      visit('arrived'),
      visit('in_progress'),
      visit('completed', 'A', 1500),
      visit('no_show'),
    ];
    const out = aggregate(visits, DEFAULT_CODES);
    expect(out.statusBreakdown).toEqual({
      scheduled: 1,
      arrived: 1,
      in_progress: 1,
      completed: 1,
      no_show: 1,
    });
  });

  it('breaks down by payment code (only completed contribute)', () => {
    const visits = [
      visit('completed', 'A', 1500),
      visit('completed', 'A', 1500),
      visit('completed', 'B', 1000),
      visit('completed', 'E', 0),
      // Scheduled with code should not count — visit isn't done yet.
      visit('scheduled', 'A', null),
    ];
    const out = aggregate(visits, DEFAULT_CODES);
    const byCode = Object.fromEntries(out.paymentCodeBreakdown.map((e) => [e.code, e]));
    expect(byCode.A?.count).toBe(2);
    expect(byCode.A?.totalCents).toBe(3000);
    expect(byCode.B?.count).toBe(1);
    expect(byCode.B?.totalCents).toBe(1000);
    expect(byCode.C?.count).toBe(0);
    expect(byCode.C?.totalCents).toBe(0);
    expect(byCode.D?.count).toBe(0);
    expect(byCode.E?.count).toBe(1);
    expect(byCode.E?.totalCents).toBe(0);
  });

  it('handles empty input', () => {
    const out = aggregate([], DEFAULT_CODES);
    expect(out.totalRevenueCents).toBe(0);
    expect(out.paidCount).toBe(0);
    expect(out.statusBreakdown).toEqual({
      scheduled: 0,
      arrived: 0,
      in_progress: 0,
      completed: 0,
      no_show: 0,
    });
    expect(out.paymentCodeBreakdown).toHaveLength(5);
    expect(out.paymentCodeBreakdown.every((e) => e.count === 0)).toBe(true);
  });

  it('drops payment data for a completed row with no code', () => {
    const visits = [visit('completed', null, null)];
    const out = aggregate(visits, DEFAULT_CODES);
    expect(out.totalRevenueCents).toBe(0);
    expect(out.paidCount).toBe(0);
    expect(out.statusBreakdown.completed).toBe(1);
  });
});
