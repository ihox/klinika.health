// Visit DTO validation + row→DTO conversion tests.
//
// The auto-save path is forgiving by design (empty payloads are
// no-ops, every field is optional) but defensively rejects
// negative numbers and obviously-out-of-range vitals so the doctor
// can't accidentally store nonsense.

import { describe, expect, it } from 'vitest';

import {
  CreateVisitSchema,
  UpdateVisitSchema,
  toVisitDto,
} from './visits.dto';

describe('CreateVisitSchema', () => {
  it('accepts a patientId-only payload', () => {
    const r = CreateVisitSchema.safeParse({
      patientId: '11111111-1111-1111-1111-111111111111',
    });
    expect(r.success).toBe(true);
  });

  it('rejects unknown keys', () => {
    const r = CreateVisitSchema.safeParse({
      patientId: '11111111-1111-1111-1111-111111111111',
      complaint: 'should be on PATCH not POST',
    });
    expect(r.success).toBe(false);
  });

  it('rejects a non-UUID patientId', () => {
    const r = CreateVisitSchema.safeParse({ patientId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });

  it('accepts an explicit visitDate', () => {
    const r = CreateVisitSchema.safeParse({
      patientId: '11111111-1111-1111-1111-111111111111',
      visitDate: '2026-05-14',
    });
    expect(r.success).toBe(true);
  });
});

describe('UpdateVisitSchema', () => {
  it('accepts a single-field delta', () => {
    const r = UpdateVisitSchema.safeParse({ complaint: 'Kollë e thatë.' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.complaint).toBe('Kollë e thatë.');
  });

  it('normalises whitespace-only strings to null', () => {
    const r = UpdateVisitSchema.safeParse({ complaint: '   ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.complaint).toBeNull();
  });

  it('rejects negative weight (defensive sanity)', () => {
    const r = UpdateVisitSchema.safeParse({ weightG: -100 });
    expect(r.success).toBe(false);
  });

  it('rejects negative height', () => {
    const r = UpdateVisitSchema.safeParse({ heightCm: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects implausible temperature', () => {
    expect(UpdateVisitSchema.safeParse({ temperatureC: 10 }).success).toBe(false);
    expect(UpdateVisitSchema.safeParse({ temperatureC: 50 }).success).toBe(false);
  });

  it('accepts realistic vitals', () => {
    const r = UpdateVisitSchema.safeParse({
      weightG: 13600,
      heightCm: 92,
      headCircumferenceCm: 48.2,
      temperatureC: 37.2,
    });
    expect(r.success).toBe(true);
  });

  it('accepts a known payment code', () => {
    expect(UpdateVisitSchema.safeParse({ paymentCode: 'A' }).success).toBe(true);
    expect(UpdateVisitSchema.safeParse({ paymentCode: 'F' }).success).toBe(false);
  });

  it('allows null to clear a field', () => {
    const r = UpdateVisitSchema.safeParse({ weightG: null, complaint: '' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.weightG).toBeNull();
      expect(r.data.complaint).toBeNull();
    }
  });

  it('rejects unknown keys', () => {
    const r = UpdateVisitSchema.safeParse({ secretField: 'sneak' });
    expect(r.success).toBe(false);
  });
});

describe('toVisitDto', () => {
  const baseRow = {
    id: 'v-1',
    clinicId: 'c-1',
    patientId: 'p-1',
    visitDate: new Date('2026-05-14T00:00:00Z'),
    status: 'completed',
    complaint: 'Kollë',
    feedingNotes: null,
    feedingBreast: false,
    feedingFormula: true,
    feedingSolid: true,
    weightG: 13_600,
    heightCm: '92.0',
    headCircumferenceCm: { toString: () => '48.20' },
    temperatureC: 37.2,
    paymentCode: 'A',
    examinations: null,
    ultrasoundNotes: null,
    legacyDiagnosis: null,
    prescription: null,
    labResults: null,
    followupNotes: null,
    otherNotes: null,
    createdAt: new Date('2026-05-14T08:00:00Z'),
    updatedAt: new Date('2026-05-14T08:00:00Z'),
    createdBy: 'u-1',
    updatedBy: 'u-1',
  };

  it('serialises Decimal columns as numbers', () => {
    const dto = toVisitDto(baseRow);
    expect(dto.heightCm).toBe(92);
    expect(dto.headCircumferenceCm).toBe(48.2);
    expect(dto.temperatureC).toBe(37.2);
  });

  it('marks a freshly-created visit as wasUpdated: false', () => {
    const dto = toVisitDto(baseRow);
    expect(dto.wasUpdated).toBe(false);
  });

  it('marks an edited visit as wasUpdated: true once updatedAt exceeds the skew window', () => {
    const dto = toVisitDto({
      ...baseRow,
      updatedAt: new Date('2026-05-14T08:01:00Z'),
    });
    expect(dto.wasUpdated).toBe(true);
  });

  it('emits visitDate as ISO yyyy-mm-dd', () => {
    expect(toVisitDto(baseRow).visitDate).toBe('2026-05-14');
  });

  it('normalises malformed paymentCode to null (defense in depth)', () => {
    const dto = toVisitDto({ ...baseRow, paymentCode: 'X' });
    expect(dto.paymentCode).toBeNull();
  });
});
