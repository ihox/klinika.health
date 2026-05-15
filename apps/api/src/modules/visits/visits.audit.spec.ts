// Audit-log pinning tests for the visit-edit + status-change paths.
//
// `computeDiffs` (the diff function itself) is already pinned in
// visits.service.spec.ts. This spec stitches the diff function to the
// end-to-end service flow and verifies the `audit.record` call shape
// — the contract the v1.x amendments UI will build on top of.
//
// Three cases the spec pins, mapping 1:1 to the brief from STEP 5:
//   1. Doctor edits a single field on a completed visit
//      → audit row { action: 'visit.updated', changes: [{ field, old, new }] }
//   2. Doctor edits multiple fields at once
//      → one audit row with one diff per changed field
//   3. Status change from in_progress → completed (Përfundo vizitën)
//      → audit row { action: 'visit.status_changed', changes
//                    includes { field: 'status', old: 'in_progress',
//                    new: 'completed' } }
//
// Mocks `prisma.$transaction` to invoke the callback inline with the
// same `tx` shape — that's the wrapper VisitsService.update uses. The
// calendar service's changeStatus is a flat (non-transactional) path,
// so a regular mock works.

import { describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../../common/request-context/request-context';
import { VisitsService } from './visits.service';
import { VisitsCalendarService } from './visits-calendar.service';

const CLINIC = 'clinic-uuid';
const VISIT = 'visit-uuid';
const DOCTOR = 'doctor-uuid';

function makeCtx(): RequestContext {
  return {
    clinicId: CLINIC,
    clinicSubdomain: 'donetamed',
    clinicStatus: 'active',
    userId: DOCTOR,
    roles: ['doctor'],
    sessionId: 'session-uuid',
    ipAddress: '127.0.0.1',
    userAgent: 'vitest',
    requestId: 'req-uuid',
    isPlatform: false,
  };
}

interface VisitRowShape {
  id: string;
  clinicId: string;
  patientId: string;
  status: string;
  visitDate: Date;
  scheduledFor: Date | null;
  arrivedAt: Date | null;
  isWalkIn: boolean;
  complaint: string | null;
  feedingNotes: string | null;
  feedingBreast: boolean;
  feedingFormula: boolean;
  feedingSolid: boolean;
  weightG: number | null;
  heightCm: unknown;
  headCircumferenceCm: unknown;
  temperatureC: unknown;
  paymentCode: string | null;
  examinations: string | null;
  ultrasoundNotes: string | null;
  legacyDiagnosis: string | null;
  prescription: string | null;
  labResults: string | null;
  followupNotes: string | null;
  otherNotes: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
  diagnoses: { icd10Code: string; orderIndex: number; code: { code: string; latinDescription: string } }[];
}

function baseRow(overrides: Partial<VisitRowShape> = {}): VisitRowShape {
  return {
    id: VISIT,
    clinicId: CLINIC,
    patientId: 'patient-uuid',
    status: 'completed',
    visitDate: new Date('2026-05-15T00:00:00Z'),
    scheduledFor: new Date('2026-05-15T09:00:00Z'),
    arrivedAt: new Date('2026-05-15T09:00:00Z'),
    isWalkIn: false,
    complaint: null,
    feedingNotes: null,
    feedingBreast: false,
    feedingFormula: false,
    feedingSolid: false,
    weightG: null,
    heightCm: null,
    headCircumferenceCm: null,
    temperatureC: null,
    paymentCode: null,
    examinations: null,
    ultrasoundNotes: null,
    legacyDiagnosis: null,
    prescription: null,
    labResults: null,
    followupNotes: null,
    otherNotes: null,
    createdBy: DOCTOR,
    updatedBy: DOCTOR,
    createdAt: new Date('2026-05-15T08:00:00Z'),
    updatedAt: new Date('2026-05-15T09:30:00Z'),
    diagnoses: [],
    ...overrides,
  };
}

function setupUpdate(beforeRow: VisitRowShape, afterRow: VisitRowShape) {
  const txVisit = {
    findFirst: vi.fn().mockResolvedValue(beforeRow),
    update: vi.fn().mockResolvedValue(afterRow),
    findUniqueOrThrow: vi.fn().mockResolvedValue(afterRow),
  };
  const tx = { visit: txVisit };
  const prisma = {
    $transaction: vi.fn().mockImplementation(
      (cb: (innerTx: typeof tx) => Promise<unknown>) => cb(tx),
    ),
  };

  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const calendar = {};
  const calendarEvents = { emit: vi.fn() };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new VisitsService(
    prisma as any,
    audit as any,
    calendar as any,
    calendarEvents as any,
  );
  /* eslint-enable */

  return { service, prisma, audit, txVisit };
}

// ---------------------------------------------------------------------------
// VisitsService.update — visit.updated audit row
// ---------------------------------------------------------------------------

describe('VisitsService.update — audit-log field-level diffs', () => {
  it('records a single { field: "weightG", old, new } diff for a one-field edit on a completed visit', async () => {
    // Doctor reopened a completed visit via Anulo statusin, edited
    // the weight, saved. The audit row should capture the diff so a
    // future amendments UI can surface it as a tracked correction.
    const before = baseRow({ status: 'completed', weightG: 12_000 });
    const after = baseRow({ status: 'completed', weightG: 13_000 });
    const { service, audit } = setupUpdate(before, after);

    await service.update(CLINIC, VISIT, { weightG: 13_000 }, makeCtx());

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'visit.updated',
      resourceType: 'visit',
      resourceId: VISIT,
    });
    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
      old: unknown;
      new: unknown;
    }>;
    expect(changes).toEqual([{ field: 'weightG', old: 12_000, new: 13_000 }]);
  });

  it('records one diff per changed field in a single audit row for multi-field edits', async () => {
    const before = baseRow({
      complaint: 'Kollë',
      weightG: 12_000,
      paymentCode: null,
    });
    const after = baseRow({
      complaint: 'Kollë me ethe',
      weightG: 13_000,
      paymentCode: 'A',
    });
    const { service, audit } = setupUpdate(before, after);

    await service.update(
      CLINIC,
      VISIT,
      { complaint: 'Kollë me ethe', weightG: 13_000, paymentCode: 'A' },
      makeCtx(),
    );

    expect(audit.record).toHaveBeenCalledTimes(1);
    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
    }>;
    expect(changes.map((c) => c.field).sort()).toEqual([
      'complaint',
      'paymentCode',
      'weightG',
    ]);
  });

  it('skips the audit row when no tracked fields changed (no-op PATCH)', async () => {
    const before = baseRow({ complaint: 'same' });
    const after = baseRow({ complaint: 'same' });
    const { service, audit } = setupUpdate(before, after);

    // Send a payload that resolves to "no diff" — the field is the
    // same on both sides. The service must NOT write an empty audit
    // row (would pollute the change-history modal).
    await service.update(CLINIC, VISIT, { complaint: 'same' }, makeCtx());

    expect(audit.record).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// VisitsCalendarService.changeStatus — visit.status_changed audit row
// ---------------------------------------------------------------------------

interface CalendarRowShape {
  id: string;
  clinicId: string;
  patientId: string;
  status: string;
  visitDate: Date;
  scheduledFor: Date | null;
  arrivedAt: Date | null;
  isWalkIn: boolean;
  durationMinutes: number | null;
  paymentCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  patient: { id: string; firstName: string; lastName: string; dateOfBirth: Date | null };
}

function setupChangeStatus(
  before: Partial<CalendarRowShape>,
  ctx: RequestContext = makeCtx(),
) {
  const beforeRow: CalendarRowShape = {
    id: VISIT,
    clinicId: CLINIC,
    patientId: 'patient-uuid',
    status: 'in_progress',
    visitDate: new Date('2026-05-15T00:00:00Z'),
    scheduledFor: new Date('2026-05-15T09:00:00Z'),
    arrivedAt: new Date('2026-05-15T09:00:00Z'),
    isWalkIn: false,
    durationMinutes: 15,
    paymentCode: null,
    createdAt: new Date('2026-05-15T08:30:00Z'),
    updatedAt: new Date('2026-05-15T09:00:00Z'),
    patient: {
      id: 'patient-uuid',
      firstName: 'Era',
      lastName: 'Krasniqi',
      dateOfBirth: null,
    },
    ...before,
  };

  const prisma = {
    visit: {
      findFirst: vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
        // The service issues a second findFirst against `patient` for
        // the "last visit map" enrichment — return null so the
        // map-building skips this caller's patient cleanly.
        if (where['patientId'] && !where['id']) return Promise.resolve(null);
        return Promise.resolve(beforeRow);
      }),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...beforeRow, ...data }),
      ),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    clinic: { findUnique: vi.fn().mockResolvedValue({ paymentCodes: {} }) },
  };

  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const events = { emit: vi.fn() };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new VisitsCalendarService(
    prisma as any,
    audit as any,
    events as any,
  );
  /* eslint-enable */

  return { service, prisma, audit, events, beforeRow, ctx };
}

describe('VisitsCalendarService.changeStatus — visit.status_changed audit', () => {
  it('records { field: "status", old: "in_progress", new: "completed" } on Përfundo vizitën', async () => {
    const { service, audit } = setupChangeStatus({ status: 'in_progress' });
    await service.changeStatus(CLINIC, VISIT, { status: 'completed' }, makeCtx());

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'visit.status_changed',
      resourceType: 'visit',
      resourceId: VISIT,
    });
    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
      old: unknown;
      new: unknown;
    }>;
    expect(changes).toContainEqual({
      field: 'status',
      old: 'in_progress',
      new: 'completed',
    });
  });

  it('records the reverse status diff on Anulo statusin (completed → arrived)', async () => {
    const { service, audit } = setupChangeStatus({
      status: 'completed',
      // Today's row so the receptionist edit-lock would pass even if it
      // were active (doctor ctx skips the lock regardless).
      visitDate: new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`),
    });
    await service.changeStatus(CLINIC, VISIT, { status: 'arrived' }, makeCtx());

    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
      old: unknown;
      new: unknown;
    }>;
    expect(changes).toContainEqual({
      field: 'status',
      old: 'completed',
      new: 'arrived',
    });
  });

  it('also stamps arrivedAt on the first scheduled → arrived transition', async () => {
    // Bookings start with arrivedAt = null; the first transition into
    // 'arrived' (receptionist marking a patient as checked in) should
    // produce a `{ field: 'arrivedAt' }` diff alongside the status one.
    const { service, audit } = setupChangeStatus({
      status: 'scheduled',
      arrivedAt: null,
    });
    await service.changeStatus(CLINIC, VISIT, { status: 'arrived' }, makeCtx());

    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
    }>;
    const fields = changes.map((c) => c.field);
    expect(fields).toContain('status');
    expect(fields).toContain('arrivedAt');
  });
});
