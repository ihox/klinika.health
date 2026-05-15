// Unit tests for the receptionist privacy boundary.
//
// These prove the DTO chokepoint never leaks PHI regardless of the
// shape handed in. The integration test in
// `patients.integration.spec.ts` proves the chokepoint is actually
// used by the controllers — together they form the receptionist
// safety net per CLAUDE.md §1.2.

import { describe, expect, it } from 'vitest';

import {
  computeIsComplete,
  DoctorCreatePatientSchema,
  PatientSearchQuerySchema,
  ReceptionistCreatePatientSchema,
  toFullDto,
  toPublicDto,
} from './patients.dto';

describe('PatientPublicDto serialization', () => {
  const fullRow = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    clinicId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    legacyId: 4829,
    firstName: 'Era',
    lastName: 'Krasniqi',
    dateOfBirth: new Date('2023-08-03T00:00:00Z'),
    sex: 'f' as const,
    placeOfBirth: 'Prizren',
    phone: '+383 44 123 456',
    birthWeightG: 3280,
    birthLengthCm: '51.00',
    birthHeadCircumferenceCm: '34.00',
    alergjiTjera: 'Penicilinë, dhembet mjekun',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    // Also throw in some "future field" the schema doesn't know about.
    secretField: 'this should never leak',
    deletedAt: null,
  };

  it('returns exactly the public keys', () => {
    const out = toPublicDto(fullRow);
    expect(Object.keys(out).sort()).toEqual([
      'dateOfBirth',
      'firstName',
      'id',
      'lastName',
      'lastVisitAt',
    ]);
  });

  it('omits every PHI field even when given a full Prisma row', () => {
    const out = toPublicDto(fullRow) as unknown as Record<string, unknown>;
    const forbidden = [
      'phone',
      'placeOfBirth',
      'alergjiTjera',
      'birthWeightG',
      'birthLengthCm',
      'birthHeadCircumferenceCm',
      'sex',
      'legacyId',
      'clinicId',
      'secretField',
      'createdAt',
      'updatedAt',
      'deletedAt',
    ];
    for (const f of forbidden) {
      expect(out[f]).toBeUndefined();
    }
  });

  it('renders the date of birth as ISO yyyy-mm-dd', () => {
    const out = toPublicDto(fullRow);
    expect(out.dateOfBirth).toBe('2023-08-03');
  });

  it('returns null DOB when the row has no date of birth', () => {
    const out = toPublicDto({ ...fullRow, dateOfBirth: null });
    expect(out.dateOfBirth).toBeNull();
  });

  it('accepts string DOBs from raw $queryRaw rows', () => {
    const out = toPublicDto({ ...fullRow, dateOfBirth: '2023-08-03' as unknown as Date });
    expect(out.dateOfBirth).toBe('2023-08-03');
  });

  it('round-tripping a 200-key garbage object only returns the allowed keys', () => {
    // Defensive property-style proof. If someone in the future hands
    // toPublicDto a result of a raw `SELECT *` PLUS arbitrary extra
    // keys, only the allowed ones come back.
    const garbage: Record<string, unknown> = { ...fullRow };
    for (let i = 0; i < 200; i += 1) garbage[`extra_${i}`] = `secret-${i}`;
    const out = toPublicDto(garbage as Parameters<typeof toPublicDto>[0]) as unknown as Record<string, unknown>;
    expect(Object.keys(out)).toHaveLength(5);
    for (let i = 0; i < 200; i += 1) {
      expect(out[`extra_${i}`]).toBeUndefined();
    }
  });

  it('renders lastVisitAt as ISO yyyy-mm-dd when present', () => {
    const out = toPublicDto({
      ...fullRow,
      lastVisitAt: new Date('2026-05-01T00:00:00Z'),
    });
    expect(out.lastVisitAt).toBe('2026-05-01');
  });

  it('returns null lastVisitAt when the row has none', () => {
    const out = toPublicDto(fullRow);
    expect(out.lastVisitAt).toBeNull();
  });

  it('accepts string lastVisitAt from raw $queryRaw rows', () => {
    const out = toPublicDto({
      ...fullRow,
      lastVisitAt: '2026-05-01' as unknown as Date,
    });
    expect(out.lastVisitAt).toBe('2026-05-01');
  });
});

describe('PatientFullDto serialization', () => {
  const fullRow = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    clinicId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    legacyId: 4829,
    firstName: 'Era',
    lastName: 'Krasniqi',
    dateOfBirth: new Date('2023-08-03T00:00:00Z'),
    sex: 'f' as const,
    placeOfBirth: 'Prizren',
    phone: '+383 44 123 456',
    birthWeightG: 3280,
    // Prisma Decimals serialize via toString().
    birthLengthCm: { toString: () => '51' },
    birthHeadCircumferenceCm: { toString: () => '34' },
    alergjiTjera: 'Penicilinë',
    createdAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
  };

  it('converts Decimal-like values to numbers', () => {
    const out = toFullDto(fullRow);
    expect(out.birthLengthCm).toBe(51);
    expect(out.birthHeadCircumferenceCm).toBe(34);
  });

  it('preserves clinical fields verbatim', () => {
    const out = toFullDto(fullRow);
    expect(out.alergjiTjera).toBe('Penicilinë');
    expect(out.phone).toBe('+383 44 123 456');
    expect(out.placeOfBirth).toBe('Prizren');
    expect(out.sex).toBe('f');
    expect(out.legacyId).toBe(4829);
  });

  it('marks a fully populated patient as complete', () => {
    const out = toFullDto(fullRow);
    expect(out.isComplete).toBe(true);
  });

  it('marks a patient missing sex as incomplete', () => {
    const out = toFullDto({ ...fullRow, sex: null });
    expect(out.isComplete).toBe(false);
  });

  it('marks a patient with the sentinel DOB as incomplete', () => {
    // The receptionist quick-add path stores 1900-01-01 when no DOB
    // is captured. The DTO maps it to null, and isComplete should
    // reflect that.
    const out = toFullDto({
      ...fullRow,
      dateOfBirth: new Date('1900-01-01T00:00:00Z'),
    });
    expect(out.dateOfBirth).toBeNull();
    expect(out.isComplete).toBe(false);
  });

  it('marks a patient with an empty lastName as incomplete', () => {
    const out = toFullDto({ ...fullRow, lastName: '' });
    expect(out.isComplete).toBe(false);
  });
});

describe('computeIsComplete', () => {
  it('requires all four fields', () => {
    expect(
      computeIsComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'f',
      }),
    ).toBe(true);
  });

  it('returns false when any required field is empty/null', () => {
    expect(
      computeIsComplete({
        firstName: '',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: 'f',
      }),
    ).toBe(false);
    expect(
      computeIsComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: null,
        sex: 'f',
      }),
    ).toBe(false);
    expect(
      computeIsComplete({
        firstName: 'Era',
        lastName: 'Krasniqi',
        dateOfBirth: '2023-08-03',
        sex: null,
      }),
    ).toBe(false);
  });
});

describe('ReceptionistCreatePatientSchema', () => {
  it('accepts the minimal happy-path body', () => {
    const out = ReceptionistCreatePatientSchema.safeParse({
      firstName: 'Rita',
      lastName: 'Hoxha',
      dateOfBirth: '2024-02-12',
    });
    expect(out.success).toBe(true);
  });

  it('accepts a body without dateOfBirth', () => {
    const out = ReceptionistCreatePatientSchema.safeParse({
      firstName: 'Rita',
      lastName: 'Hoxha',
    });
    expect(out.success).toBe(true);
  });

  it('silently drops extra keys (privacy boundary)', () => {
    // Zod default is `.strip()` — extra keys parse successfully but
    // never appear in `data`. The service layer also only writes the
    // three permitted fields, so even if this loosened further the
    // DB would stay clean.
    const out = ReceptionistCreatePatientSchema.safeParse({
      firstName: 'Rita',
      lastName: 'Hoxha',
      phone: '+383 44 111 111',
      alergjiTjera: 'tries to inject',
      birthWeightG: 3500,
    });
    expect(out.success).toBe(true);
    if (out.success) {
      const data = out.data as Record<string, unknown>;
      expect(data.phone).toBeUndefined();
      expect(data.alergjiTjera).toBeUndefined();
      expect(data.birthWeightG).toBeUndefined();
    }
  });

  it('rejects future date of birth', () => {
    const future = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const out = ReceptionistCreatePatientSchema.safeParse({
      firstName: 'Rita',
      lastName: 'Hoxha',
      dateOfBirth: future,
    });
    expect(out.success).toBe(false);
  });

  it('rejects empty first name', () => {
    const a = ReceptionistCreatePatientSchema.safeParse({ firstName: '', lastName: 'X' });
    const b = ReceptionistCreatePatientSchema.safeParse({ firstName: '   ' });
    expect(a.success).toBe(false);
    expect(b.success).toBe(false);
  });

  it('accepts firstName-only (lastName optional)', () => {
    const out = ReceptionistCreatePatientSchema.safeParse({ firstName: 'Rita' });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.firstName).toBe('Rita');
      expect(out.data.lastName).toBe('');
    }
  });

  it('treats whitespace-only lastName as empty', () => {
    const out = ReceptionistCreatePatientSchema.safeParse({
      firstName: 'Rita',
      lastName: '   ',
    });
    expect(out.success).toBe(true);
    if (out.success) {
      expect(out.data.lastName).toBe('');
    }
  });
});

describe('DoctorCreatePatientSchema', () => {
  it('accepts a full master-data body', () => {
    const out = DoctorCreatePatientSchema.safeParse({
      firstName: 'Era',
      lastName: 'Krasniqi',
      dateOfBirth: '2023-08-03',
      sex: 'f',
      placeOfBirth: 'Prizren',
      phone: '+383 44 123 456',
      birthWeightG: 3280,
      birthLengthCm: 51,
      birthHeadCircumferenceCm: 34,
      alergjiTjera: 'Penicilinë',
    });
    expect(out.success).toBe(true);
  });

  it('rejects unknown keys (defense-in-depth)', () => {
    const out = DoctorCreatePatientSchema.safeParse({
      firstName: 'Era',
      lastName: 'Krasniqi',
      dateOfBirth: '2023-08-03',
      bloodType: 'O+',
    });
    expect(out.success).toBe(false);
  });

  it('rejects malformed phones', () => {
    const out = DoctorCreatePatientSchema.safeParse({
      firstName: 'Era',
      lastName: 'Krasniqi',
      dateOfBirth: '2023-08-03',
      phone: '<<inject>>',
    });
    expect(out.success).toBe(false);
  });

  it('requires dateOfBirth (doctor full form always captures it)', () => {
    const out = DoctorCreatePatientSchema.safeParse({
      firstName: 'Era',
      lastName: 'Krasniqi',
    });
    expect(out.success).toBe(false);
  });
});

describe('PatientSearchQuerySchema', () => {
  it('parses numeric limit from string', () => {
    const out = PatientSearchQuerySchema.safeParse({ q: 'Hoxha', limit: '5' });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.limit).toBe(5);
  });

  it('defaults limit to 10', () => {
    const out = PatientSearchQuerySchema.safeParse({ q: 'Hoxha' });
    expect(out.success).toBe(true);
    if (out.success) expect(out.data.limit).toBe(10);
  });

  it('rejects limit > 20', () => {
    const out = PatientSearchQuerySchema.safeParse({ q: 'Hoxha', limit: '50' });
    expect(out.success).toBe(false);
  });
});
