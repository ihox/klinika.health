import { describe, expect, it } from 'vitest';

import type { DailyReportVisit } from '@/lib/daily-report-client';

import {
  buildGreeting,
  centsToEur,
  chipLabel,
  countPaid,
  formatCompactSq,
  formatDl,
  isPaid,
  isReceptionistOnlyRoles,
  primaryRoleFor,
  stepDay,
  sumCents,
} from './raporti-utils';

function visit(
  status: DailyReportVisit['status'],
  paymentCode: DailyReportVisit['paymentCode'] = null,
  paymentAmountCents: number | null = null,
): DailyReportVisit {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    time: '10:00',
    patient: {
      id: '00000000-0000-0000-0000-000000000001',
      firstName: 'A',
      lastName: 'B',
      dateOfBirth: '2020-01-01',
    },
    status,
    isWalkIn: false,
    paymentCode,
    paymentAmountCents,
    isFirstVisit: false,
  };
}

describe('stepDay', () => {
  it('steps forward', () => {
    expect(stepDay('2026-05-22', 1)).toBe('2026-05-23');
  });
  it('steps back across month', () => {
    expect(stepDay('2026-06-01', -1)).toBe('2026-05-31');
  });
});

describe('formatCompactSq', () => {
  it('formats with Albanian month abbreviation', () => {
    expect(formatCompactSq('2026-05-22')).toBe('22 maj 2026');
    expect(formatCompactSq('2026-01-01')).toBe('1 jan 2026');
  });
});

describe('formatDl', () => {
  it('formats as dd.mm.yyyy', () => {
    expect(formatDl('2018-04-12')).toBe('12.04.2018');
  });
  it('returns em-dash for null', () => {
    expect(formatDl(null)).toBe('—');
  });
});

describe('centsToEur', () => {
  it('rounds to whole euros (no decimals)', () => {
    expect(centsToEur(23500)).toBe('235');
    expect(centsToEur(0)).toBe('0');
    expect(centsToEur(1500)).toBe('15');
  });
});

describe('isPaid / countPaid', () => {
  it('excludes E (Falas) and non-completed rows', () => {
    expect(isPaid(visit('completed', 'A', 1500))).toBe(true);
    expect(isPaid(visit('completed', 'E', 0))).toBe(false);
    expect(isPaid(visit('completed', null, null))).toBe(false);
    expect(isPaid(visit('scheduled', 'A', 1500))).toBe(false);
    expect(isPaid(visit('no_show', null, null))).toBe(false);
  });
  it('countPaid counts only paid completed rows', () => {
    const visits = [
      visit('completed', 'A', 1500),
      visit('completed', 'B', 1000),
      visit('completed', 'E', 0),
      visit('scheduled', 'A', null),
      visit('no_show', null, null),
    ];
    expect(countPaid(visits)).toBe(2);
  });
});

describe('sumCents', () => {
  it('sums completed-row amounts only', () => {
    const visits = [
      visit('completed', 'A', 1500),
      visit('completed', 'B', 1000),
      visit('completed', 'E', 0),
      visit('scheduled', 'A', null),
      visit('completed', null, null),
    ];
    expect(sumCents(visits)).toBe(2500);
  });
});

describe('chipLabel', () => {
  it('maps each status to Albanian', () => {
    expect(chipLabel('completed')).toBe('Përfunduar');
    expect(chipLabel('no_show')).toBe('Mungesë');
    expect(chipLabel('scheduled')).toBe('I planifikuar');
    expect(chipLabel('arrived')).toBe('Paraqitur');
    expect(chipLabel('in_progress')).toBe('Në vizitë');
  });
});

describe('isReceptionistOnlyRoles', () => {
  it('returns true only when role array is receptionist alone', () => {
    expect(isReceptionistOnlyRoles(['receptionist'])).toBe(true);
    expect(isReceptionistOnlyRoles(['receptionist', 'doctor'])).toBe(false);
    expect(isReceptionistOnlyRoles(['receptionist', 'clinic_admin'])).toBe(false);
    expect(isReceptionistOnlyRoles(['doctor'])).toBe(false);
    expect(isReceptionistOnlyRoles([])).toBe(false);
  });
});

describe('buildGreeting', () => {
  it('uses morning greeting before noon', () => {
    expect(buildGreeting('Taulant', new Date('2026-05-22T08:00:00'))).toMatch(
      /^Mirëmëngjes, Taulant/,
    );
  });
  it('uses afternoon greeting from noon to 18:00', () => {
    expect(buildGreeting('Taulant', new Date('2026-05-22T13:00:00'))).toMatch(
      /^Mirëdita, Taulant/,
    );
  });
  it('uses evening greeting after 18:00', () => {
    expect(buildGreeting('Taulant', new Date('2026-05-22T19:00:00'))).toMatch(
      /^Mirëmbrëma, Taulant/,
    );
  });
  it('drops the name when not provided', () => {
    expect(buildGreeting('', new Date('2026-05-22T08:00:00'))).toBe('Mirëmëngjes');
  });
});

describe('primaryRoleFor', () => {
  it('doctor wins over other roles', () => {
    expect(primaryRoleFor(['receptionist', 'doctor'])).toBe('Mjeku');
  });
  it('clinic_admin wins over receptionist', () => {
    expect(primaryRoleFor(['receptionist', 'clinic_admin'])).toBe('Administrator');
  });
  it('returns empty for empty input', () => {
    expect(primaryRoleFor([])).toBe('');
  });
});
