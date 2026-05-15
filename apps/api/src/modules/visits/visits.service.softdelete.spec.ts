// Unit tests for VisitsService.softDelete + .restore — verifies the
// SSE emissions added so the receptionist's open calendar refreshes
// in real time when the doctor deletes (or undeletes) a visit from
// inside the chart/visit-form.
//
// The receptionist's calendar-scoped softDelete/restore (visits-
// calendar.service.ts) already emit visit.deleted / visit.restored.
// The doctor's chart-side paths are separate service functions that
// previously skipped the emit on restore (and only landed delete
// after Phase 2b) — leaving any open receptionist tab showing stale
// rows until the next manual refresh. These tests pin the emit shape
// on both paths so they can never drift again.
//
// Also covers the optional "Pse?" reason field on softDelete: when
// the doctor filled the dialog input, the reason rides into the
// audit-log changes as `{ field: 'deleteReason' }`. Empty / missing
// reasons must NOT add that diff entry (dialog is opt-in).

import { describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../../common/request-context/request-context';
import { VisitsService } from './visits.service';

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
  scheduledFor: Date | null;
  arrivedAt: Date | null;
  isWalkIn: boolean;
  status: string;
  visitDate: Date;
}

function setup(row: VisitRowShape) {
  const prisma = {
    visit: {
      findFirst: vi.fn().mockResolvedValue(row),
      update: vi.fn().mockResolvedValue({ ...row, deletedAt: new Date() }),
    },
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

  return { service, prisma, audit, calendarEvents };
}

/** Variant that simulates a soft-deleted row coming back from
 *  findFirst (deletedAt set) and update clearing it (deletedAt null) —
 *  the shape the chart-side restore() walks through. The mock fills
 *  every field `toVisitDto` reads so the DTO serialisation doesn't
 *  trip on an undefined timestamp. */
function setupRestoring(row: Omit<VisitRowShape, 'deletedAt'> & { deletedAt: Date }) {
  const fullRow = {
    ...row,
    clinicId: CLINIC,
    patientId: 'patient-uuid',
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
  };

  const prisma = {
    visit: {
      findFirst: vi.fn().mockResolvedValue(fullRow),
      update: vi.fn().mockResolvedValue({ ...fullRow, deletedAt: null }),
    },
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

  return { service, prisma, audit, calendarEvents };
}

describe('VisitsService.softDelete — SSE emission', () => {
  it('emits visit.deleted on a scheduled booking with the booking date as localDate', async () => {
    // scheduled_for = 2026-05-15 11:00 Belgrade (UTC+2 in May)
    //               = 2026-05-15 09:00 UTC
    const scheduledFor = new Date('2026-05-15T09:00:00Z');
    const { service, calendarEvents } = setup({
      id: VISIT,
      scheduledFor,
      arrivedAt: null,
      isWalkIn: false,
      status: 'scheduled',
      visitDate: new Date('2026-05-15T00:00:00Z'),
    });

    await service.softDelete(CLINIC, VISIT, makeCtx());

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    const event = calendarEvents.emit.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'visit.deleted',
      clinicId: CLINIC,
      visitId: VISIT,
      localDate: '2026-05-15',
      isWalkIn: false,
      status: 'scheduled',
    });
    expect(typeof event.emittedAt).toBe('string');
  });

  it('emits visit.deleted on a walk-in with the arrived_at date as localDate', async () => {
    const arrivedAt = new Date('2026-05-15T08:30:00Z');
    const { service, calendarEvents } = setup({
      id: VISIT,
      scheduledFor: null,
      arrivedAt,
      isWalkIn: true,
      status: 'in_progress',
      visitDate: new Date('2026-05-15T00:00:00Z'),
    });

    await service.softDelete(CLINIC, VISIT, makeCtx());

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    expect(calendarEvents.emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'visit.deleted',
      clinicId: CLINIC,
      visitId: VISIT,
      localDate: '2026-05-15',
      isWalkIn: true,
      status: 'in_progress',
    });
  });

  it('falls back to visitDate as localDate for chart-only standalone visits', async () => {
    // Doctor-created standalone chart entry (no schedule, not a walk-in).
    // Receptionist never sees this on the calendar, but the event shape
    // must still be well-formed so the SSE channel doesn't drop it.
    const { service, calendarEvents } = setup({
      id: VISIT,
      scheduledFor: null,
      arrivedAt: null,
      isWalkIn: false,
      status: 'completed',
      visitDate: new Date('2026-05-15T00:00:00Z'),
    });

    await service.softDelete(CLINIC, VISIT, makeCtx());

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    expect(calendarEvents.emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'visit.deleted',
      localDate: '2026-05-15',
      isWalkIn: false,
      status: 'completed',
    });
  });

  it('still writes the visit.deleted audit row alongside the emit', async () => {
    const { service, audit, calendarEvents } = setup({
      id: VISIT,
      scheduledFor: new Date('2026-05-15T09:00:00Z'),
      arrivedAt: null,
      isWalkIn: false,
      status: 'scheduled',
      visitDate: new Date('2026-05-15T00:00:00Z'),
    });

    await service.softDelete(CLINIC, VISIT, makeCtx());

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'visit.deleted',
      resourceType: 'visit',
      resourceId: VISIT,
    });
    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
  });
});

describe('VisitsService.softDelete — optional "Pse?" reason', () => {
  it('includes deleteReason in the audit changes when the doctor filled the field', async () => {
    const { service, audit } = setup({
      id: VISIT,
      scheduledFor: new Date('2026-05-15T09:00:00Z'),
      arrivedAt: null,
      isWalkIn: false,
      status: 'scheduled',
      visitDate: new Date('2026-05-15T00:00:00Z'),
    });

    await service.softDelete(CLINIC, VISIT, makeCtx(), 'Pacienti u regjistrua dy herë');

    expect(audit.record).toHaveBeenCalledTimes(1);
    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
      new: unknown;
    }>;
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'deletedAt' }),
        expect.objectContaining({
          field: 'deleteReason',
          new: 'Pacienti u regjistrua dy herë',
        }),
      ]),
    );
  });

  it('trims whitespace-only reasons to nothing (no deleteReason diff)', async () => {
    const { service, audit } = setup({
      id: VISIT,
      scheduledFor: new Date('2026-05-15T09:00:00Z'),
      arrivedAt: null,
      isWalkIn: false,
      status: 'scheduled',
      visitDate: new Date('2026-05-15T00:00:00Z'),
    });

    await service.softDelete(CLINIC, VISIT, makeCtx(), '   ');

    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
    }>;
    expect(changes.find((c) => c.field === 'deleteReason')).toBeUndefined();
  });

  it('omits deleteReason when no reason is supplied (default null path)', async () => {
    const { service, audit } = setup({
      id: VISIT,
      scheduledFor: new Date('2026-05-15T09:00:00Z'),
      arrivedAt: null,
      isWalkIn: false,
      status: 'scheduled',
      visitDate: new Date('2026-05-15T00:00:00Z'),
    });

    // No 4th argument — exercises the controller's "no body" path.
    await service.softDelete(CLINIC, VISIT, makeCtx());

    const changes = audit.record.mock.calls[0]?.[0]?.changes as Array<{
      field: string;
    }>;
    expect(changes).toEqual([
      expect.objectContaining({ field: 'deletedAt' }),
    ]);
  });
});

describe('VisitsService.restore — SSE emission', () => {
  it('emits visit.restored with the booking date as localDate', async () => {
    const scheduledFor = new Date('2026-05-15T09:00:00Z');
    const { service, calendarEvents } = setupRestoring({
      id: VISIT,
      scheduledFor,
      arrivedAt: null,
      isWalkIn: false,
      status: 'scheduled',
      visitDate: new Date('2026-05-15T00:00:00Z'),
      deletedAt: new Date('2026-05-15T10:00:00Z'),
    });

    await service.restore(CLINIC, VISIT, makeCtx());

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    const event = calendarEvents.emit.mock.calls[0]?.[0];
    expect(event).toMatchObject({
      type: 'visit.restored',
      clinicId: CLINIC,
      visitId: VISIT,
      localDate: '2026-05-15',
      isWalkIn: false,
      status: 'scheduled',
      actorUserId: DOCTOR,
    });
    expect(typeof event.emittedAt).toBe('string');
  });

  it('emits visit.restored with the arrived_at date for a walk-in', async () => {
    const arrivedAt = new Date('2026-05-15T08:30:00Z');
    const { service, calendarEvents } = setupRestoring({
      id: VISIT,
      scheduledFor: null,
      arrivedAt,
      isWalkIn: true,
      status: 'in_progress',
      visitDate: new Date('2026-05-15T00:00:00Z'),
      deletedAt: new Date('2026-05-15T09:30:00Z'),
    });

    await service.restore(CLINIC, VISIT, makeCtx());

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    expect(calendarEvents.emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'visit.restored',
      localDate: '2026-05-15',
      isWalkIn: true,
      status: 'in_progress',
    });
  });

  it('falls back to visitDate for chart-only standalone visits', async () => {
    const { service, calendarEvents } = setupRestoring({
      id: VISIT,
      scheduledFor: null,
      arrivedAt: null,
      isWalkIn: false,
      status: 'completed',
      visitDate: new Date('2026-05-15T00:00:00Z'),
      deletedAt: new Date('2026-05-15T10:00:00Z'),
    });

    await service.restore(CLINIC, VISIT, makeCtx());

    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
    expect(calendarEvents.emit.mock.calls[0]?.[0]).toMatchObject({
      type: 'visit.restored',
      localDate: '2026-05-15',
    });
  });

  it('writes a visit.restored audit row alongside the emit', async () => {
    const { service, audit, calendarEvents } = setupRestoring({
      id: VISIT,
      scheduledFor: new Date('2026-05-15T09:00:00Z'),
      arrivedAt: null,
      isWalkIn: false,
      status: 'scheduled',
      visitDate: new Date('2026-05-15T00:00:00Z'),
      deletedAt: new Date('2026-05-15T10:00:00Z'),
    });

    await service.restore(CLINIC, VISIT, makeCtx());

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'visit.restored',
      resourceType: 'visit',
      resourceId: VISIT,
    });
    expect(calendarEvents.emit).toHaveBeenCalledTimes(1);
  });
});
