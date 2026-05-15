// Phase 2b patch — unit tests for `VisitsService.createDoctorNew`'s
// patient-active-visit-today gate.
//
// The full DB round-trip lives in the gated integration spec; this
// spec stubs Prisma + collaborators so the gate logic runs in the
// fast unit suite. We assert which DB-create shape the service emits:
//   - regular  → no isWalkIn, no scheduledFor, no pairedWithVisitId
//                (defaults from Prisma schema apply)
//   - walk-in  → isWalkIn=true, status='in_progress', pairedWithVisitId set
//   - standalone fallback → no isWalkIn (defaults from Prisma schema apply)
//
// CLAUDE.md §1.5 — Albanian-only UI applies to user-facing strings, not
// to comments or test identifiers, which stay in English for clarity.

import { describe, expect, it, vi } from 'vitest';

import type { RequestContext } from '../../common/request-context/request-context';
import { VisitsService } from './visits.service';

const CLINIC = 'clinic-uuid';
const PATIENT = 'patient-uuid';
const DOCTOR = 'doctor-uuid';
const PAIR_TARGET = 'pair-uuid';

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

interface SetupOpts {
  /** What `prisma.visit.findFirst` returns for the active-visit-today check. */
  activeVisitToday: { id: string } | null;
  /**
   * What `calendar.findNextUnpairedScheduledVisit` returns when the gate
   * does NOT short-circuit. Default `null` (fallback path).
   */
  pair?: { id: string; scheduledFor: Date | null } | null;
}

function setup(opts: SetupOpts) {
  // `toVisitDto` calls `.toISOString()` on createdAt + updatedAt, so the
  // mock returns concrete Dates. We don't care about the row contents
  // beyond what the service projects — every test asserts on the
  // `data` argument that was passed in, not the response.
  const visitCreate = vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: 'new-visit-uuid',
      ...data,
      visitDate: data['visitDate'] ?? new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      diagnoses: [],
    }),
  );

  const prisma = {
    patient: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: PATIENT, firstName: 'Era', lastName: 'X' }),
    },
    visit: {
      findFirst: vi.fn().mockResolvedValue(opts.activeVisitToday),
      create: visitCreate,
    },
  };

  const calendar = {
    findNextUnpairedScheduledVisit: vi
      .fn()
      .mockResolvedValue(opts.pair ?? null),
    computeWalkInArrivedAt: vi
      .fn()
      .mockResolvedValue(new Date('2026-05-15T10:00:00Z')),
    getClinicWalkInDuration: vi.fn().mockResolvedValue(5),
  };

  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const calendarEvents = { emit: vi.fn() };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new VisitsService(
    prisma as any,
    audit as any,
    calendar as any,
    calendarEvents as any,
  );
  /* eslint-enable */

  return { service, prisma, calendar, audit, calendarEvents, visitCreate };
}

describe('VisitsService.createDoctorNew — patient-active-visit-today gate', () => {
  const payload = { patientId: PATIENT };

  it('takes the regular-visit path when the patient has an active row today', async () => {
    const { service, calendar, visitCreate } = setup({
      activeVisitToday: { id: 'today-row' },
    });
    await service.createDoctorNew(CLINIC, payload, makeCtx());

    // Gate fired → pair lookup never runs.
    expect(calendar.findNextUnpairedScheduledVisit).not.toHaveBeenCalled();
    expect(calendar.computeWalkInArrivedAt).not.toHaveBeenCalled();

    // visit.create is invoked with the regular shape: no isWalkIn,
    // no pairing, no scheduledFor; defaults apply for status etc.
    expect(visitCreate).toHaveBeenCalledTimes(1);
    const data = visitCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data['isWalkIn']).toBeUndefined();
    expect(data['scheduledFor']).toBeUndefined();
    expect(data['pairedWithVisitId']).toBeUndefined();
    expect(data['arrivedAt']).toBeUndefined();
    expect(data['status']).toBeUndefined();
  });

  it('queries the gate scoped to this patient with the active-status whitelist', async () => {
    const { service, prisma } = setup({ activeVisitToday: { id: 't' } });
    await service.createDoctorNew(CLINIC, payload, makeCtx());

    expect(prisma.visit.findFirst).toHaveBeenCalledTimes(1);
    const where = prisma.visit.findFirst.mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where['clinicId']).toBe(CLINIC);
    expect(where['patientId']).toBe(PATIENT);
    expect(where['deletedAt']).toBeNull();
    expect(where['status']).toEqual({
      in: ['scheduled', 'arrived', 'in_progress'],
    });
    // Date column query: utcMidnight(today) — Date instance, not a bare string.
    expect(where['visitDate']).toBeInstanceOf(Date);
  });

  it('takes the walk-in path when patient has NO row today and a pair target exists', async () => {
    const { service, visitCreate } = setup({
      activeVisitToday: null,
      pair: { id: PAIR_TARGET, scheduledFor: new Date('2026-05-15T10:30:00Z') },
    });
    await service.createDoctorNew(CLINIC, payload, makeCtx());

    expect(visitCreate).toHaveBeenCalledTimes(1);
    const data = visitCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data['isWalkIn']).toBe(true);
    expect(data['status']).toBe('in_progress');
    expect(data['pairedWithVisitId']).toBe(PAIR_TARGET);
    expect(data['scheduledFor']).toBeNull();
    expect(data['arrivedAt']).toBeInstanceOf(Date);
  });

  it('takes the standalone fallback when patient has NO row today and no pair target', async () => {
    const { service, visitCreate } = setup({
      activeVisitToday: null,
      pair: null,
    });
    await service.createDoctorNew(CLINIC, payload, makeCtx());

    // Fallback is `this.create()` — regular shape, no walk-in flag.
    expect(visitCreate).toHaveBeenCalledTimes(1);
    const data = visitCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data['isWalkIn']).toBeUndefined();
    expect(data['pairedWithVisitId']).toBeUndefined();
    expect(data['scheduledFor']).toBeUndefined();
  });

  it('does not emit the walk-in arrival SSE on the regular-visit gate path', async () => {
    const { service, calendarEvents } = setup({
      activeVisitToday: { id: 't' },
    });
    await service.createDoctorNew(CLINIC, payload, makeCtx());
    expect(calendarEvents.emit).not.toHaveBeenCalled();
  });
});
