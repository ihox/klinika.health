// Unit tests for the pure formatting helpers used by the print
// templates. These pin date / weight / age math without spinning up
// Puppeteer.

import { describe, expect, it } from 'vitest';

import {
  ageLabelLong,
  ageLine,
  escapeHtml,
  formatCertificateNumber,
  formatIsoDateDdMmYy,
  formatIsoDateDdMmYyyy,
  formatLengthCm,
  formatPatientIdLabel,
  formatTemperatureC,
  formatWeightG,
  formatWeightKg,
  hasText,
  hoursLineFromConfig,
  sexLabel,
  vertetimDaysInclusive,
} from './print.format';

describe('formatIsoDateDdMmYyyy', () => {
  it('formats yyyy-mm-dd into dd.mm.yyyy', () => {
    expect(formatIsoDateDdMmYyyy('2026-05-14')).toBe('14.05.2026');
  });
  it('returns em-dash for null / empty', () => {
    expect(formatIsoDateDdMmYyyy(null)).toBe('—');
    expect(formatIsoDateDdMmYyyy(undefined)).toBe('—');
  });
  it('passes through unparseable strings', () => {
    expect(formatIsoDateDdMmYyyy('bad')).toBe('bad');
  });
});

describe('formatIsoDateDdMmYy', () => {
  it('uses 2-digit year', () => {
    expect(formatIsoDateDdMmYy('2026-05-14')).toBe('14.05.26');
  });
});

describe('formatWeightG', () => {
  it('formats with thin-space thousands separator', () => {
    expect(formatWeightG(3280)).toBe('3 280 g');
  });
  it('omits separator for sub-1000', () => {
    expect(formatWeightG(420)).toBe('420 g');
  });
  it('returns em-dash for null', () => {
    expect(formatWeightG(null)).toBe('—');
  });
});

describe('formatWeightKg', () => {
  it('always shows one decimal', () => {
    expect(formatWeightKg(13.6)).toBe('13.6 kg');
    expect(formatWeightKg(14)).toBe('14.0 kg');
  });
});

describe('formatLengthCm', () => {
  it('drops decimal for whole-number heights', () => {
    expect(formatLengthCm(92)).toBe('92 cm');
  });
  it('keeps one decimal for fractional heights', () => {
    expect(formatLengthCm(48.2)).toBe('48.2 cm');
  });
});

describe('formatTemperatureC', () => {
  it('formats with degree symbol', () => {
    expect(formatTemperatureC(37.2)).toBe('37.2 °C');
  });
});

describe('ageLabelLong', () => {
  const asOf = '2026-05-14';
  it('returns days for newborns', () => {
    expect(ageLabelLong('2026-05-09', asOf)).toBe('5 ditë');
  });
  it('returns months for sub-2yr', () => {
    expect(ageLabelLong('2025-09-14', asOf)).toBe('8 muaj');
  });
  it('returns years + months for older children', () => {
    expect(ageLabelLong('2023-08-03', asOf)).toBe('2 vjeç 9 muaj');
  });
  it('uses "1 vit" for exactly one year', () => {
    expect(ageLabelLong('2025-05-14', '2026-05-14')).toBe('1 vit');
  });
  it('returns empty for null dob', () => {
    expect(ageLabelLong(null, asOf)).toBe('');
  });
});

describe('sexLabel + ageLine', () => {
  it('combines sex and age with a separator', () => {
    expect(ageLine('2023-08-03', 'f', '2026-05-14')).toBe('vajzë · 2 vjeç 9 muaj');
    expect(ageLine('2025-09-14', 'm', '2026-05-14')).toBe('djalë · 8 muaj');
  });
  it('omits sex when null', () => {
    expect(ageLine('2025-09-14', null, '2026-05-14')).toBe('8 muaj');
  });
  it('falls back to just sex when dob is null', () => {
    expect(ageLine(null, 'f', '2026-05-14')).toBe('vajzë');
  });
  it('returns empty when neither known', () => {
    expect(ageLine(null, null, '2026-05-14')).toBe('');
  });
  it('sexLabel handles all branches', () => {
    expect(sexLabel('m')).toBe('djalë');
    expect(sexLabel('f')).toBe('vajzë');
    expect(sexLabel(null)).toBe('');
  });
});

describe('hoursLineFromConfig', () => {
  it('reads mon open/start/end', () => {
    const cfg = {
      days: { mon: { open: true, start: '10:00', end: '18:00' } },
    };
    expect(hoursLineFromConfig(cfg)).toBe('10:00 – 18:00');
  });
  it('falls back when shape is unexpected', () => {
    expect(hoursLineFromConfig({})).toBe('10:00 – 18:00');
    expect(hoursLineFromConfig(null)).toBe('10:00 – 18:00');
  });
});

describe('formatPatientIdLabel', () => {
  it('zero-pads legacy ids', () => {
    expect(formatPatientIdLabel(4829, '00000000-0000-0000-0000-000000000000')).toBe('PT-04829');
  });
  it('uses uuid slug for new patients', () => {
    expect(formatPatientIdLabel(null, '12345678-abcd-4ef0-9012-345678901234')).toBe(
      'PT-12345678'.toUpperCase(),
    );
  });
});

describe('formatCertificateNumber', () => {
  it('formats year-NNNN', () => {
    expect(formatCertificateNumber(new Date('2026-05-14T11:00:00Z'), 142)).toBe('2026-0142');
  });
});

describe('vertetimDaysInclusive', () => {
  it('returns 1 for the same day', () => {
    expect(vertetimDaysInclusive('2026-05-14', '2026-05-14')).toBe(1);
  });
  it('counts both endpoints (Mon-Fri = 5)', () => {
    expect(vertetimDaysInclusive('2026-05-11', '2026-05-15')).toBe(5);
  });
  it('throws when to < from', () => {
    expect(() => vertetimDaysInclusive('2026-05-15', '2026-05-14')).toThrow(
      /pavlefshme/,
    );
  });
});

describe('hasText / escapeHtml', () => {
  it('hasText rejects empty + whitespace', () => {
    expect(hasText(null)).toBe(false);
    expect(hasText('')).toBe(false);
    expect(hasText('   ')).toBe(false);
    expect(hasText('abc')).toBe(true);
  });
  it('escapeHtml replaces the common five entities', () => {
    expect(escapeHtml(`<b>"a&'</b>`)).toBe('&lt;b&gt;&quot;a&amp;&#039;&lt;/b&gt;');
  });
});
