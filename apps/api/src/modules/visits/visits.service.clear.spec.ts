// Unit tests for VisitsService.clear / clearUndo — "Pastro vizitën"
// (Phase 2c).
//
// The flow:
//   1. Doctor clicks Pastro on today's completed visit → snapshot
//      captured to visit_clear_snapshots, clinical fields wiped, status
//      flipped to 'arrived'.
//   2. Within 15s, doctor clicks Undo → snapshot consumed, fields
//      restored, status flipped back to 'completed'.
//
// The tests pin: validation paths (not completed, not today,
// receptionist refused), the SSE shape, the audit log calls, and the
// happy-path snapshot round-trip.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { RequestContext } from '../../common/request-context/request-context';
import { VisitsService } from './visits.service';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const VISIT = '22222222-2222-2222-2222-222222222222';
const DOCTOR = '33333333-3333-3333-3333-333333333333';
const SNAPSHOT = '44444444-4444-4444-4444-444444444444';

function makeCtx(roles: RequestContext['roles'] = ['doctor']): RequestContext {
  return {
    clinicId: CLINIC,
    clinicSubdomain: 'donetamed',
    clinicStatus: 'active',
    userId: DOCTOR,
    roles,
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
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy: string;
  diagnoses: Array<{ icd10Code: string; orderIndex: number; code?: { latinDescription: string } }>;
}

function makeVisit(overrides: Partial<VisitRowShape> = {}): VisitRowShape {
  return {
    id: VISIT,
    clinicId: CLINIC,
    patientId: 'patient-uuid',
    status: 'completed',
    visitDate: new Date('2026-05-15T00:00:00Z'),
    scheduledFor: new Date('2026-05-15T08:00:00Z'),
    arrivedAt: new Date('2026-05-15T08:00:00Z'),
    isWalkIn: false,
    complaint: 'Temperaturë e lartë',
    feedingNotes: null,
    feedingBreast: false,
    feedingFormula: true,
    feedingSolid: false,
    weightG: 12000,
    heightCm: '85.50',
    headCircumferenceCm: null,
    temperatureC: '37.80',
    paymentCode: 'A',
    examinations: 'Pulmones — bilateral',
    ultrasoundNotes: null,
    legacyDiagnosis: null,
    prescription: 'Paracetamol 250mg s.3x',
    labResults: null,
    followupNotes: 'Kontroll pas 3 ditësh',
    otherNotes: null,
    createdAt: new Date('2026-05-15T08:00:00Z'),
    updatedAt: new Date('2026-05-15T09:00:00Z'),
    createdBy: DOCTOR,
    updatedBy: DOCTOR,
    diagnoses: [
      { icd10Code: 'J06.9', orderIndex: 0, code: { latinDescription: 'Infectio acuta' } },
      { icd10Code: 'R50.9', orderIndex: 1, code: { latinDescription: 'Pyrexia' } },
    ],
    ...overrides,
  };
}

interface SnapshotRow {
  id: string;
  clinicId: string;
  visitId: string;
  fields: Record<string, unknown>;
  diagnoses: Array<{ icd10Code: string; orderIndex: number }>;
  previousStatus: string;
  clearedBy: string;
  expiresAt: Date;
  createdAt: Date;
}

function setup(opts: {
  visit?: VisitRowShape | null;
  snapshot?: SnapshotRow | null;
} = {}) {
  const visitRow = opts.visit !== undefined ? opts.visit : makeVisit();
  const snapshotRow = opts.snapshot ?? null;

  // tx mock — used inside `prisma.$transaction(async (tx) => …)`.
  const tx = {
    visit: {
      findFirst: vi.fn().mockResolvedValue(visitRow),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...(visitRow ?? {}),
        ...data,
        // Resolve the `updatedByUser: { connect: { id } }` connect shape
        // back to the scalar for assertion convenience.
        updatedBy:
          (data['updatedByUser'] as { connect?: { id?: string } } | undefined)?.connect?.id ?? DOCTOR,
        diagnoses: visitRow?.diagnoses ?? [],
      })),
      findUniqueOrThrow: vi.fn().mockResolvedValue(visitRow),
    },
    visitDiagnosis: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    visitClearSnapshot: {
      upsert: vi.fn().mockImplementation(async ({ create }: { create: SnapshotRow }) => ({
        ...create,
        id: SNAPSHOT,
        createdAt: new Date(),
      })),
      findFirst: vi.fn().mockResolvedValue(snapshotRow),
      delete: vi.fn().mockResolvedValue(snapshotRow),
    },
  };

  const prisma = {
    $transaction: vi.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    visit: tx.visit,
    visitDiagnosis: tx.visitDiagnosis,
    visitClearSnapshot: tx.visitClearSnapshot,
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

  return { service, prisma, tx, audit, calendarEvents };
}

describe('VisitsService.clear — Pastro vizitën', () => {
  beforeEach(() => {
    // Pin "today" to 2026-05-15 (Belgrade) so visitDate match logic is
    // deterministic regardless of host clock.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears clinical fields, flips status to arrived, returns undoableUntil', async () => {
    const { service, tx, audit, calendarEvents } = setup();

    const result = await service.clear(CLINIC, VISIT, makeCtx());

    expect(result.visit).toBeDefined();
    expect(result.undoableUntil).toBe(
      new Date('2026-05-15T10:00:15.000Z').toISOString(),
    );

    expect(tx.visit.update).toHaveBeenCalledTimes(1);
    const updateCall = tx.visit.update.mock.calls[0]?.[0];
    expect(updateCall.where).toEqual({ id: VISIT });
    expect(updateCall.data).toMatchObject({
      status: 'arrived',
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
    });

    expect(tx.visitDiagnosis.deleteMany).toHaveBeenCalledWith({
      where: { visitId: VISIT },
    });

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'visit.cleared',
      resourceType: 'visit',
      resourceId: VISIT,
    });

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    expect(calendarEvents.emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'visit.status_changed',
      clinicId: CLINIC,
      visitId: VISIT,
      status: 'arrived',
      previousStatus: 'completed',
      localDate: '2026-05-15',
    });
  });

  it('captures the snapshot before mutating (fields + diagnoses + previousStatus)', async () => {
    const { service, tx } = setup();

    await service.clear(CLINIC, VISIT, makeCtx());

    expect(tx.visitClearSnapshot.upsert).toHaveBeenCalledTimes(1);
    const call = tx.visitClearSnapshot.upsert.mock.calls[0]?.[0];
    expect(call.where).toEqual({ visitId: VISIT });
    expect(call.create).toMatchObject({
      clinicId: CLINIC,
      visitId: VISIT,
      previousStatus: 'completed',
      clearedBy: DOCTOR,
    });
    expect(call.create.fields).toMatchObject({
      complaint: 'Temperaturë e lartë',
      feedingFormula: true,
      weightG: 12000,
      heightCm: '85.50',
      temperatureC: '37.80',
      paymentCode: 'A',
      examinations: 'Pulmones — bilateral',
      prescription: 'Paracetamol 250mg s.3x',
      followupNotes: 'Kontroll pas 3 ditësh',
    });
    expect(call.create.diagnoses).toEqual([
      { icd10Code: 'J06.9', orderIndex: 0 },
      { icd10Code: 'R50.9', orderIndex: 1 },
    ]);
    expect(call.create.expiresAt.getTime()).toBe(
      new Date('2026-05-15T10:00:00Z').getTime() + 15_000,
    );
  });

  it('rejects a past-day completed visit with not_today', async () => {
    const visit = makeVisit({
      visitDate: new Date('2026-05-14T00:00:00Z'),
    });
    const { service } = setup({ visit });

    await expect(service.clear(CLINIC, VISIT, makeCtx())).rejects.toMatchObject({
      response: { reason: 'not_today' },
    });
  });

  it('rejects a scheduled visit with not_completed', async () => {
    const visit = makeVisit({ status: 'scheduled' });
    const { service } = setup({ visit });

    await expect(service.clear(CLINIC, VISIT, makeCtx())).rejects.toMatchObject({
      response: { reason: 'not_completed' },
    });
  });

  it('rejects an arrived visit with not_completed', async () => {
    const visit = makeVisit({ status: 'arrived' });
    const { service } = setup({ visit });

    await expect(service.clear(CLINIC, VISIT, makeCtx())).rejects.toMatchObject({
      response: { reason: 'not_completed' },
    });
  });

  it('rejects an in_progress visit with not_completed', async () => {
    const visit = makeVisit({ status: 'in_progress' });
    const { service } = setup({ visit });

    await expect(service.clear(CLINIC, VISIT, makeCtx())).rejects.toMatchObject({
      response: { reason: 'not_completed' },
    });
  });

  it('404s when the visit does not exist', async () => {
    const { service } = setup({ visit: null });

    await expect(service.clear(CLINIC, VISIT, makeCtx())).rejects.toThrow(
      'Vizita nuk u gjet.',
    );
  });

  it('refuses receptionist-only sessions', async () => {
    const { service } = setup();

    await expect(
      service.clear(CLINIC, VISIT, makeCtx(['receptionist'])),
    ).rejects.toThrow('Vetëm mjeku ka qasje');
  });

  it('allows a multi-role user with doctor + clinic_admin', async () => {
    const { service } = setup();

    await expect(
      service.clear(CLINIC, VISIT, makeCtx(['doctor', 'clinic_admin'])),
    ).resolves.toBeDefined();
  });

  it('allows clinic_admin (without doctor) too', async () => {
    const { service } = setup();

    await expect(
      service.clear(CLINIC, VISIT, makeCtx(['clinic_admin'])),
    ).resolves.toBeDefined();
  });

  it('still allows when a receptionist role is paired with clinical access', async () => {
    const { service } = setup();

    await expect(
      service.clear(CLINIC, VISIT, makeCtx(['receptionist', 'clinic_admin'])),
    ).resolves.toBeDefined();
  });
});

describe('VisitsService.clearUndo — Pastro vizitën undo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T10:00:05Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeSnapshot(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
    return {
      id: SNAPSHOT,
      clinicId: CLINIC,
      visitId: VISIT,
      fields: {
        complaint: 'Temperaturë e lartë',
        feedingNotes: null,
        feedingBreast: false,
        feedingFormula: true,
        feedingSolid: false,
        weightG: 12000,
        heightCm: '85.50',
        headCircumferenceCm: null,
        temperatureC: '37.80',
        paymentCode: 'A',
        examinations: 'Pulmones — bilateral',
        ultrasoundNotes: null,
        legacyDiagnosis: null,
        prescription: 'Paracetamol 250mg s.3x',
        labResults: null,
        followupNotes: 'Kontroll pas 3 ditësh',
        otherNotes: null,
      },
      diagnoses: [
        { icd10Code: 'J06.9', orderIndex: 0 },
        { icd10Code: 'R50.9', orderIndex: 1 },
      ],
      previousStatus: 'completed',
      clearedBy: DOCTOR,
      expiresAt: new Date('2026-05-15T10:00:15Z'),
      createdAt: new Date('2026-05-15T10:00:00Z'),
      ...overrides,
    };
  }

  it('restores clinical fields, recreates diagnoses, deletes snapshot, emits SSE', async () => {
    const snapshot = makeSnapshot();
    const visit = makeVisit({
      // Mirror the post-clear state — fields wiped, status arrived.
      status: 'arrived',
      complaint: null,
      feedingFormula: false,
      weightG: null,
      heightCm: null,
      temperatureC: null,
      paymentCode: null,
      examinations: null,
      prescription: null,
      followupNotes: null,
      diagnoses: [],
    });

    const { service, tx, audit, calendarEvents } = setup({ visit, snapshot });

    const result = await service.clearUndo(CLINIC, VISIT, makeCtx());

    expect(result).toBeDefined();

    expect(tx.visit.update).toHaveBeenCalledTimes(1);
    expect(tx.visit.update.mock.calls[0]?.[0].data).toMatchObject({
      status: 'completed',
      complaint: 'Temperaturë e lartë',
      feedingFormula: true,
      weightG: 12000,
      paymentCode: 'A',
      prescription: 'Paracetamol 250mg s.3x',
    });

    expect(tx.visitDiagnosis.createMany).toHaveBeenCalledTimes(1);
    expect(tx.visitDiagnosis.createMany.mock.calls[0]?.[0].data).toEqual([
      { visitId: VISIT, icd10Code: 'J06.9', orderIndex: 0 },
      { visitId: VISIT, icd10Code: 'R50.9', orderIndex: 1 },
    ]);

    expect(tx.visitClearSnapshot.delete).toHaveBeenCalledWith({
      where: { id: SNAPSHOT },
    });

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'visit.cleared.undone',
      resourceType: 'visit',
      resourceId: VISIT,
    });

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    expect(calendarEvents.emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'visit.status_changed',
      clinicId: CLINIC,
      visitId: VISIT,
      status: 'completed',
      previousStatus: 'arrived',
    });
  });

  it('skips createMany when the snapshot had no diagnoses', async () => {
    const snapshot = makeSnapshot({ diagnoses: [] });
    const { service, tx } = setup({ snapshot });

    await service.clearUndo(CLINIC, VISIT, makeCtx());

    expect(tx.visitDiagnosis.createMany).not.toHaveBeenCalled();
  });

  it('rejects with undo_window_expired when expires_at <= now', async () => {
    vi.setSystemTime(new Date('2026-05-15T10:00:20Z')); // 5s after expiry
    const snapshot = makeSnapshot();
    const { service, tx } = setup({ snapshot });

    await expect(service.clearUndo(CLINIC, VISIT, makeCtx())).rejects.toMatchObject({
      response: { reason: 'undo_window_expired' },
    });

    // Stale row tidied on the read path.
    expect(tx.visitClearSnapshot.delete).toHaveBeenCalledWith({
      where: { id: SNAPSHOT },
    });
  });

  it('404s when no snapshot exists', async () => {
    const { service } = setup({ snapshot: null });

    await expect(service.clearUndo(CLINIC, VISIT, makeCtx())).rejects.toThrow(
      'Asnjë veprim për anulim.',
    );
  });

  it('refuses receptionist-only sessions', async () => {
    const { service } = setup({ snapshot: makeSnapshot() });

    await expect(
      service.clearUndo(CLINIC, VISIT, makeCtx(['receptionist'])),
    ).rejects.toThrow('Vetëm mjeku ka qasje');
  });
});
