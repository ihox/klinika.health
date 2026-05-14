// Unit tests for the appointments DTOs and helpers.

import { describe, expect, it } from 'vitest';

import {
  AppointmentRangeQuerySchema,
  AppointmentStatsQuerySchema,
  CreateAppointmentSchema,
  UpdateAppointmentSchema,
  colorIndicatorForLastVisit,
} from './appointments.dto';

describe('colorIndicatorForLastVisit', () => {
  const now = new Date('2026-05-14T12:00:00Z');

  it('returns null when there is no prior visit', () => {
    expect(colorIndicatorForLastVisit(null, now)).toBeNull();
  });

  it('returns red within the first week', () => {
    expect(
      colorIndicatorForLastVisit(new Date(now.getTime() - 3 * 86_400_000), now),
    ).toBe('red');
  });

  it('returns red exactly at 7 days (inclusive lower band)', () => {
    expect(
      colorIndicatorForLastVisit(new Date(now.getTime() - 7 * 86_400_000), now),
    ).toBe('red');
  });

  it('returns yellow between 7 and 30 days', () => {
    expect(
      colorIndicatorForLastVisit(new Date(now.getTime() - 15 * 86_400_000), now),
    ).toBe('yellow');
  });

  it('returns yellow at exactly 30 days (inclusive upper band)', () => {
    expect(
      colorIndicatorForLastVisit(new Date(now.getTime() - 30 * 86_400_000), now),
    ).toBe('yellow');
  });

  it('returns green after 30 days', () => {
    expect(
      colorIndicatorForLastVisit(new Date(now.getTime() - 40 * 86_400_000), now),
    ).toBe('green');
  });

  it('ignores future "last visits" gracefully', () => {
    expect(
      colorIndicatorForLastVisit(new Date(now.getTime() + 5 * 86_400_000), now),
    ).toBeNull();
  });

  it('handles malformed strings', () => {
    expect(colorIndicatorForLastVisit('not-a-date', now)).toBeNull();
  });
});

describe('AppointmentRangeQuerySchema', () => {
  it('accepts a valid range', () => {
    expect(
      AppointmentRangeQuerySchema.safeParse({ from: '2026-05-14', to: '2026-05-20' }).success,
    ).toBe(true);
  });
  it('rejects inverted ranges', () => {
    const r = AppointmentRangeQuerySchema.safeParse({ from: '2026-05-20', to: '2026-05-14' });
    expect(r.success).toBe(false);
  });
  it('rejects malformed dates', () => {
    const r = AppointmentRangeQuerySchema.safeParse({ from: '14/05/2026', to: '20/05/2026' });
    expect(r.success).toBe(false);
  });
});

describe('AppointmentStatsQuerySchema', () => {
  it('accepts a valid date', () => {
    expect(AppointmentStatsQuerySchema.safeParse({ date: '2026-05-14' }).success).toBe(true);
  });
  it('rejects empty', () => {
    expect(AppointmentStatsQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('CreateAppointmentSchema', () => {
  const base = {
    patientId: '00000000-0000-0000-0000-000000000001',
    date: '2026-05-14',
    time: '10:30',
    durationMinutes: 15,
  };

  it('accepts a well-formed create payload', () => {
    expect(CreateAppointmentSchema.safeParse(base).success).toBe(true);
  });

  it('rejects times outside HH:MM', () => {
    expect(CreateAppointmentSchema.safeParse({ ...base, time: '25:00' }).success).toBe(false);
    expect(CreateAppointmentSchema.safeParse({ ...base, time: '10:60' }).success).toBe(false);
  });

  it('rejects unknown patient ids', () => {
    expect(CreateAppointmentSchema.safeParse({ ...base, patientId: 'not-a-uuid' }).success).toBe(
      false,
    );
  });

  it('rejects durations outside 5..180', () => {
    expect(CreateAppointmentSchema.safeParse({ ...base, durationMinutes: 0 }).success).toBe(false);
    expect(CreateAppointmentSchema.safeParse({ ...base, durationMinutes: 200 }).success).toBe(
      false,
    );
  });

  it('rejects extra fields (strict)', () => {
    expect(
      CreateAppointmentSchema.safeParse({ ...base, notes: 'leaked PHI' }).success,
    ).toBe(false);
  });
});

describe('UpdateAppointmentSchema', () => {
  it('accepts a status-only update', () => {
    expect(UpdateAppointmentSchema.safeParse({ status: 'completed' }).success).toBe(true);
  });
  it('rejects an empty payload', () => {
    expect(UpdateAppointmentSchema.safeParse({}).success).toBe(false);
  });
  it('rejects unknown statuses', () => {
    expect(UpdateAppointmentSchema.safeParse({ status: 'mysterious' }).success).toBe(false);
  });
});
