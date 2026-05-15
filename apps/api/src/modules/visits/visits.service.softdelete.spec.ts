// Unit tests for VisitsService.softDelete — verifies the SSE emission
// added so the receptionist's open calendar refreshes in real time when
// the doctor deletes a visit from inside the chart/visit-form.
//
// The receptionist's calendar-scoped softDelete (visits-calendar.service.ts)
// already emits visit.deleted. The doctor's softDelete is a separate
// service function that previously skipped the emit — leaving any open
// receptionist tab showing a stale row until the next manual refresh.
// These tests pin the emit shape so the two paths can never drift again.

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
