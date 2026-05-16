// Slice B — unit tests for `VisitsService.createDoctorNew`'s
// patient-active-visit-today gate.
//
// The full DB round-trip lives in the gated integration spec; this
// spec stubs Prisma + collaborators so the gate logic runs in the
// fast unit suite. Three creation paths get covered:
//
//   - existed-route → gate fires; NO new row created; service returns
//                     `{ visit, existed: true }` with the seeded
//                     active visit's DTO.
//   - walk-in       → no active row today + pair target available;
//                     paired walk-in row created.
//   - standalone    → no active row today + no pair target; calendar-
//                     invisible standalone row created.
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

/**
 * Build a row shape compatible with `toVisitDto` so the existed-route
 * branch can serialize it without exploding. Only the fields the DTO
 * touches need to be present.
 */
function existingVisitRow(id: string): Record<string, unknown> {
  return {
    id,
    clinicId: CLINIC,
    patientId: PATIENT,
    visitDate: new Date('2026-05-15T00:00:00Z'),
    status: 'in_progress',
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
    createdAt: new Date('2026-05-15T09:00:00Z'),
    updatedAt: new Date('2026-05-15T09:00:00Z'),
    createdBy: DOCTOR,
    updatedBy: DOCTOR,
    diagnoses: [],
  };
}

interface SetupOpts {
  /** What `prisma.visit.findFirst` returns for the active-visit-today check. */
  activeVisitToday: Record<string, unknown> | null;
  /**
   * What `calendar.findNextUnpairedScheduledVisit` returns when the gate
   * does NOT short-circuit. Default `null` (fallback path).
   */
  pair?: { id: string; scheduledFor: Date | null } | null;
}

function setup(opts: SetupOpts) {
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

  it('returns the existing visit with existed=true when the patient has an active row today', async () => {
    const existing = existingVisitRow('today-row');
    const { service, calendar, visitCreate, audit } = setup({
      activeVisitToday: existing,
    });
    const result = await service.createDoctorNew(CLINIC, payload, makeCtx());

    // Gate fired → NO new row was created, no pair lookup ran, no
    // walk-in arrival side effects.
    expect(visitCreate).not.toHaveBeenCalled();
    expect(calendar.findNextUnpairedScheduledVisit).not.toHaveBeenCalled();
    expect(calendar.computeWalkInArrivedAt).not.toHaveBeenCalled();
    // No `visit.created` / `visit.standalone.created` audit row.
    expect(audit.record).not.toHaveBeenCalled();

    expect(result.existed).toBe(true);
    expect(result.visit.id).toBe('today-row');
  });

  it('queries the gate scoped to this patient with the active-status whitelist', async () => {
    const { service, prisma } = setup({
      activeVisitToday: existingVisitRow('today-row'),
    });
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
    const result = await service.createDoctorNew(CLINIC, payload, makeCtx());

    expect(result.existed).toBe(false);
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
    const result = await service.createDoctorNew(CLINIC, payload, makeCtx());

    expect(result.existed).toBe(false);
    // Fallback is `this.create()` — regular shape, no walk-in flag.
    expect(visitCreate).toHaveBeenCalledTimes(1);
    const data = visitCreate.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data['isWalkIn']).toBeUndefined();
    expect(data['pairedWithVisitId']).toBeUndefined();
    expect(data['scheduledFor']).toBeUndefined();
  });

  it('does not emit any SSE event on the existed-route gate path', async () => {
    const { service, calendarEvents } = setup({
      activeVisitToday: existingVisitRow('today-row'),
    });
    await service.createDoctorNew(CLINIC, payload, makeCtx());
    expect(calendarEvents.emit).not.toHaveBeenCalled();
  });
});
