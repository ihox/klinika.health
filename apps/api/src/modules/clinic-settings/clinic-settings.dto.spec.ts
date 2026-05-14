import { describe, expect, it } from 'vitest';

import {
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
