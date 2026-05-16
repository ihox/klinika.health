// Unit tests for the calendar DTOs and helpers.

import { describe, expect, it } from 'vitest';

import {
  ALLOWED_TRANSITIONS,
  CalendarRangeQuerySchema,
  CalendarStatsQuerySchema,
  CalendarAvailabilityQuerySchema,
  colorIndicatorForLastVisit,
  CreateScheduledVisitSchema,
  CreateWalkinVisitSchema,
  hasClinicalData,
  isTransitionAllowed,
  UpdateScheduledVisitSchema,
  UpdateVisitStatusSchema,
  VISIT_STATUSES,
  type VisitStatus,
} from './visits-calendar.dto';

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

  it('returns yellow between 7 and 30 days', () => {
    expect(
      colorIndicatorForLastVisit(new Date(now.getTime() - 15 * 86_400_000), now),
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

describe('CalendarRangeQuerySchema', () => {
  it('accepts a valid range', () => {
    expect(
      CalendarRangeQuerySchema.safeParse({ from: '2026-05-14', to: '2026-05-20' }).success,
    ).toBe(true);
  });
  it('rejects inverted ranges', () => {
    const r = CalendarRangeQuerySchema.safeParse({ from: '2026-05-20', to: '2026-05-14' });
    expect(r.success).toBe(false);
  });
  it('rejects malformed dates', () => {
    expect(
      CalendarRangeQuerySchema.safeParse({ from: '14/05/2026', to: '20/05/2026' }).success,
    ).toBe(false);
  });
});

describe('CalendarStatsQuerySchema', () => {
  it('accepts a valid date', () => {
    expect(CalendarStatsQuerySchema.safeParse({ date: '2026-05-14' }).success).toBe(true);
  });
  it('rejects empty', () => {
    expect(CalendarStatsQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('CalendarAvailabilityQuerySchema', () => {
  it('accepts date + time without excludeVisitId', () => {
    expect(
      CalendarAvailabilityQuerySchema.safeParse({ date: '2026-05-14', time: '10:30' }).success,
    ).toBe(true);
  });
  it('accepts an optional UUID excludeVisitId', () => {
    expect(
      CalendarAvailabilityQuerySchema.safeParse({
        date: '2026-05-14',
        time: '10:30',
        excludeVisitId: '00000000-0000-0000-0000-000000000001',
      }).success,
    ).toBe(true);
  });
  it('rejects non-UUID excludeVisitId', () => {
    expect(
      CalendarAvailabilityQuerySchema.safeParse({
        date: '2026-05-14',
        time: '10:30',
        excludeVisitId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});

describe('CreateScheduledVisitSchema', () => {
  const base = {
    patientId: '00000000-0000-0000-0000-000000000001',
    date: '2026-05-14',
    time: '10:30',
    durationMinutes: 15,
  };
  it('accepts a well-formed payload', () => {
    expect(CreateScheduledVisitSchema.safeParse(base).success).toBe(true);
  });
  it('rejects times outside HH:MM', () => {
    expect(CreateScheduledVisitSchema.safeParse({ ...base, time: '25:00' }).success).toBe(false);
  });
  it('rejects durations outside 5..180', () => {
    expect(CreateScheduledVisitSchema.safeParse({ ...base, durationMinutes: 0 }).success).toBe(
      false,
    );
    expect(CreateScheduledVisitSchema.safeParse({ ...base, durationMinutes: 200 }).success).toBe(
      false,
    );
  });
  it('rejects extra fields (strict)', () => {
    expect(
      CreateScheduledVisitSchema.safeParse({ ...base, notes: 'leaked PHI' }).success,
    ).toBe(false);
  });
});

describe('CreateWalkinVisitSchema', () => {
  it('accepts a patient and a pairing', () => {
    expect(
      CreateWalkinVisitSchema.safeParse({
        patientId: '00000000-0000-0000-0000-000000000001',
        pairedWithVisitId: '00000000-0000-0000-0000-000000000002',
      }).success,
    ).toBe(true);
  });
  it('rejects a walk-in without a pairing (CLAUDE.md §13)', () => {
    expect(
      CreateWalkinVisitSchema.safeParse({
        patientId: '00000000-0000-0000-0000-000000000001',
      }).success,
    ).toBe(false);
  });
  it('rejects a non-UUID pairing id', () => {
    expect(
      CreateWalkinVisitSchema.safeParse({
        patientId: '00000000-0000-0000-0000-000000000001',
        pairedWithVisitId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
  it('rejects extra fields (strict)', () => {
    expect(
      CreateWalkinVisitSchema.safeParse({
        patientId: '00000000-0000-0000-0000-000000000001',
        pairedWithVisitId: '00000000-0000-0000-0000-000000000002',
        date: '2026-05-14',
      }).success,
    ).toBe(false);
  });
});

describe('UpdateScheduledVisitSchema', () => {
  it('accepts a single field', () => {
    expect(UpdateScheduledVisitSchema.safeParse({ time: '11:00' }).success).toBe(true);
  });
  it('rejects an empty payload', () => {
    expect(UpdateScheduledVisitSchema.safeParse({}).success).toBe(false);
  });
});

describe('UpdateVisitStatusSchema', () => {
  it('accepts a known status', () => {
    expect(UpdateVisitStatusSchema.safeParse({ status: 'arrived' }).success).toBe(true);
  });
  it('rejects an unknown status', () => {
    expect(UpdateVisitStatusSchema.safeParse({ status: 'mysterious' }).success).toBe(false);
  });
});

describe('isTransitionAllowed (and ALLOWED_TRANSITIONS)', () => {
  it('allows the canonical happy path', () => {
    expect(isTransitionAllowed('scheduled', 'arrived')).toBe(true);
    expect(isTransitionAllowed('arrived', 'in_progress')).toBe(true);
    expect(isTransitionAllowed('in_progress', 'completed')).toBe(true);
  });

  it('allows the scheduled→no_show and scheduled→cancelled branches', () => {
    expect(isTransitionAllowed('scheduled', 'no_show')).toBe(true);
    expect(isTransitionAllowed('scheduled', 'cancelled')).toBe(true);
  });

  it('allows arrived→no_show', () => {
    expect(isTransitionAllowed('arrived', 'no_show')).toBe(true);
  });

  it('allows the "Rikthe te paraqitur" reopens', () => {
    expect(isTransitionAllowed('no_show', 'arrived')).toBe(true);
    expect(isTransitionAllowed('cancelled', 'arrived')).toBe(true);
  });

  it('allows completed→arrived (Phase 2c Pastro vizitën)', () => {
    expect(isTransitionAllowed('completed', 'arrived')).toBe(true);
  });

  it('rejects no-op transitions (same status both sides)', () => {
    for (const s of VISIT_STATUSES) {
      expect(isTransitionAllowed(s, s)).toBe(false);
    }
  });

  it('rejects illegal jumps', () => {
    expect(isTransitionAllowed('scheduled', 'completed')).toBe(false);
    expect(isTransitionAllowed('arrived', 'cancelled')).toBe(false);
    expect(isTransitionAllowed('in_progress', 'no_show')).toBe(false);
    expect(isTransitionAllowed('in_progress', 'cancelled')).toBe(false);
    expect(isTransitionAllowed('completed', 'in_progress')).toBe(false);
    expect(isTransitionAllowed('no_show', 'completed')).toBe(false);
    expect(isTransitionAllowed('cancelled', 'completed')).toBe(false);
  });

  it('accepts the Phase 2b doctor-quick-complete shortcut: arrived → completed', () => {
    expect(isTransitionAllowed('arrived', 'completed')).toBe(true);
  });

  it('accepts the autosave fast-path: scheduled → in_progress', () => {
    // The doctor opens a pre-booked patient's chart and types in a
    // clinical field. Autosave flips status straight from scheduled
    // to in_progress without the waiting-room `arrived` stop.
    expect(isTransitionAllowed('scheduled', 'in_progress')).toBe(true);
  });

  it('matrix mirrors the user-facing spec (ADR-011 / Phase 2a)', () => {
    expect(ALLOWED_TRANSITIONS.scheduled).toEqual([
      'arrived',
      'in_progress',
      'no_show',
      'cancelled',
    ]);
    expect(ALLOWED_TRANSITIONS.arrived).toEqual([
      'in_progress',
      'completed',
      'no_show',
    ]);
    expect(ALLOWED_TRANSITIONS.in_progress).toEqual(['completed']);
    expect(ALLOWED_TRANSITIONS.completed).toEqual(['arrived']);
    expect(ALLOWED_TRANSITIONS.no_show).toEqual(['arrived']);
    expect(ALLOWED_TRANSITIONS.cancelled).toEqual(['arrived']);
  });
});

describe('hasClinicalData', () => {
  const empty = {
    complaint: null,
    examinations: null,
    prescription: null,
    ultrasoundNotes: null,
    labResults: null,
    followupNotes: null,
    otherNotes: null,
    legacyDiagnosis: null,
    feedingNotes: null,
    weightG: null as number | null,
    heightCm: null as unknown,
    headCircumferenceCm: null as unknown,
    temperatureC: null as unknown,
    paymentCode: null as string | null,
    diagnosesCount: 0,
  };

  it('returns false for a fully empty row', () => {
    expect(hasClinicalData(empty)).toBe(false);
  });

  it('detects any free-text clinical field', () => {
    expect(hasClinicalData({ ...empty, complaint: 'kollë' })).toBe(true);
    expect(hasClinicalData({ ...empty, prescription: 'paracetamol' })).toBe(true);
    expect(hasClinicalData({ ...empty, examinations: 'inspeksion' })).toBe(true);
    expect(hasClinicalData({ ...empty, labResults: 'CRP' })).toBe(true);
    expect(hasClinicalData({ ...empty, followupNotes: 'kontroll në 7 ditë' })).toBe(true);
    expect(hasClinicalData({ ...empty, ultrasoundNotes: 'normal' })).toBe(true);
    expect(hasClinicalData({ ...empty, otherNotes: 'x' })).toBe(true);
    expect(hasClinicalData({ ...empty, legacyDiagnosis: 'J03.9' })).toBe(true);
    expect(hasClinicalData({ ...empty, feedingNotes: 'sisë' })).toBe(true);
  });

  it('treats whitespace-only strings as empty', () => {
    expect(hasClinicalData({ ...empty, complaint: '   \n  ' })).toBe(false);
  });

  it('detects numeric measurements', () => {
    expect(hasClinicalData({ ...empty, weightG: 9000 })).toBe(true);
    expect(hasClinicalData({ ...empty, heightCm: 70 })).toBe(true);
    expect(hasClinicalData({ ...empty, headCircumferenceCm: 42 })).toBe(true);
    expect(hasClinicalData({ ...empty, temperatureC: 37.5 })).toBe(true);
  });

  it('detects paymentCode', () => {
    expect(hasClinicalData({ ...empty, paymentCode: 'A' })).toBe(true);
  });

  it('detects linked diagnoses count > 0', () => {
    expect(hasClinicalData({ ...empty, diagnosesCount: 1 })).toBe(true);
  });
});

describe('VISIT_STATUSES', () => {
  it('contains every lifecycle value the API/DB CHECK constraint expects', () => {
    expect([...VISIT_STATUSES].sort()).toEqual(
      (['arrived', 'cancelled', 'completed', 'in_progress', 'no_show', 'scheduled'] as VisitStatus[]).sort(),
    );
  });
});
