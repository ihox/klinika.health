import { describe, expect, it } from 'vitest';

import {
  ClinicGeneralUpdateSchema,
  WalkinDurationSchema,
  defaultHoursConfig,
  defaultPaymentCodes,
  HoursConfigSchema,
  PaymentCodesSchema,
  SmtpUpdateRequestSchema,
} from './clinic-settings.dto';

describe('HoursConfigSchema', () => {
  it('accepts the DonetaMED default', () => {
    const parsed = HoursConfigSchema.safeParse(defaultHoursConfig());
    expect(parsed.success).toBe(true);
  });

  it('requires defaultDuration to be one of the listed durations', () => {
    const cfg = defaultHoursConfig();
    const parsed = HoursConfigSchema.safeParse({
      ...cfg,
      defaultDuration: 7,
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === 'defaultDuration')).toBe(true);
    }
  });

  it('rejects start >= end for an open day', () => {
    const cfg = defaultHoursConfig();
    const parsed = HoursConfigSchema.safeParse({
      ...cfg,
      days: {
        ...cfg.days,
        mon: { open: true, start: '18:00', end: '10:00' },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects malformed time strings', () => {
    const cfg = defaultHoursConfig();
    const parsed = HoursConfigSchema.safeParse({
      ...cfg,
      days: {
        ...cfg.days,
        mon: { open: true, start: '25:00', end: '17:00' },
      },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects duplicate durations', () => {
    const cfg = defaultHoursConfig();
    const parsed = HoursConfigSchema.safeParse({
      ...cfg,
      durations: [10, 15, 15, 30],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts a closed day with no times', () => {
    const cfg = defaultHoursConfig();
    const parsed = HoursConfigSchema.safeParse({
      ...cfg,
      days: {
        ...cfg.days,
        sat: { open: false },
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('PaymentCodesSchema', () => {
  it('accepts the DonetaMED defaults', () => {
    const parsed = PaymentCodesSchema.safeParse(defaultPaymentCodes());
    expect(parsed.success).toBe(true);
  });

  it('rejects negative amounts', () => {
    const parsed = PaymentCodesSchema.safeParse({
      E: { label: 'Falas', amountCents: -1 },
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects non-letter keys', () => {
    const parsed = PaymentCodesSchema.safeParse({
      '1': { label: 'Falas', amountCents: 0 },
    });
    expect(parsed.success).toBe(false);
  });

  it('requires at least one code', () => {
    const parsed = PaymentCodesSchema.safeParse({});
    expect(parsed.success).toBe(false);
  });

  it('normalises lowercase keys to uppercase', () => {
    const parsed = PaymentCodesSchema.safeParse({
      a: { label: 'Vizitë standarde', amountCents: 1500 },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.A).toBeDefined();
    }
  });
});

describe('SmtpUpdateRequestSchema', () => {
  it('accepts default mode without SMTP fields', () => {
    const parsed = SmtpUpdateRequestSchema.safeParse({ mode: 'default' });
    expect(parsed.success).toBe(true);
  });

  it('requires every SMTP field except password', () => {
    const parsed = SmtpUpdateRequestSchema.safeParse({
      mode: 'smtp',
      host: 'smtp.gmail.com',
      port: 587,
      username: 'info@donetamed.health',
      fromName: 'DonetaMED',
      fromAddress: 'info@donetamed.health',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects ports out of range', () => {
    const parsed = SmtpUpdateRequestSchema.safeParse({
      mode: 'smtp',
      host: 'smtp.gmail.com',
      port: 99_999,
      username: 'info@donetamed.health',
      fromName: 'DonetaMED',
      fromAddress: 'info@donetamed.health',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('WalkinDurationSchema', () => {
  // Phase 2b — clinic-configurable default duration for walk-ins.
  // Range 5..60 min, snapped to multiples of 5 (the snap unit of the
  // arrived_at helper). The DB CHECK constraint enforces the same
  // range; the schema enforces the multiple-of-5 nuance up-front so a
  // mistyped 7 doesn't reach Prisma.
  it('accepts every multiple of 5 in [5, 60]', () => {
    for (const v of [5, 10, 15, 30, 45, 60]) {
      expect(WalkinDurationSchema.safeParse(v).success).toBe(true);
    }
  });

  it('rejects values below the 5-min floor', () => {
    expect(WalkinDurationSchema.safeParse(0).success).toBe(false);
    expect(WalkinDurationSchema.safeParse(4).success).toBe(false);
  });

  it('rejects values above the 60-min ceiling', () => {
    expect(WalkinDurationSchema.safeParse(61).success).toBe(false);
    expect(WalkinDurationSchema.safeParse(120).success).toBe(false);
  });

  it('rejects non-multiples of 5 inside the range', () => {
    expect(WalkinDurationSchema.safeParse(7).success).toBe(false);
    expect(WalkinDurationSchema.safeParse(12).success).toBe(false);
  });

  it('rejects non-integers', () => {
    expect(WalkinDurationSchema.safeParse(5.5).success).toBe(false);
  });
});

describe('ClinicGeneralUpdateSchema', () => {
  const validPayload = {
    name: 'DonetaMED — Ordinanca Pediatrike',
    shortName: 'DonetaMED',
    address: 'Rruga Adem Jashari, p.n.',
    city: 'Prizren',
    phones: ['045 83 00 83'],
    email: 'info@donetamed.health',
    walkinDurationMinutes: 5,
  };

  it('accepts the seed clinic shape with a 5-min walk-in default', () => {
    expect(ClinicGeneralUpdateSchema.safeParse(validPayload).success).toBe(
      true,
    );
  });

  it('requires walkinDurationMinutes (the field is non-optional)', () => {
    const { walkinDurationMinutes: _drop, ...withoutDuration } = validPayload;
    expect(ClinicGeneralUpdateSchema.safeParse(withoutDuration).success).toBe(
      false,
    );
  });

  it('propagates WalkinDurationSchema errors through the parent', () => {
    expect(
      ClinicGeneralUpdateSchema.safeParse({
        ...validPayload,
        walkinDurationMinutes: 7,
      }).success,
    ).toBe(false);
  });
});
