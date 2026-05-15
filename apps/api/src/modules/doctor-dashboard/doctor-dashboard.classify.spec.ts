// Phase 2b — unit tests for the doctor's-home position classifier.
//
// The classifier ingests a chronologically-sorted appointment list
// (scheduled bookings + walk-ins, post ADR-011) and tags each row
// with `current | next | upcoming | past`. The integration spec
// covers the full DB round-trip; this spec locks down the rules in
// isolation.

import { describe, expect, it } from 'vitest';

import {
  classifyAppointments,
  type ClassifyAppointmentInput,
} from './doctor-dashboard.classify';
import type { DashboardAppointmentStatus } from './doctor-dashboard.dto';

function row(
  id: string,
  opts: {
    scheduledFor?: string | null;
    arrivedAt?: string | null;
    isWalkIn?: boolean;
    status: DashboardAppointmentStatus;
    durationMinutes?: number;
  },
): ClassifyAppointmentInput {
  const scheduledFor =
    opts.scheduledFor === undefined ? null : opts.scheduledFor === null ? null : new Date(opts.scheduledFor);
  const arrivedAt =
    opts.arrivedAt === undefined ? null : opts.arrivedAt === null ? null : new Date(opts.arrivedAt);
  const anchor = scheduledFor ?? arrivedAt;
  if (!anchor) throw new Error('row needs scheduledFor or arrivedAt');
  return {
    id,
    patientId: `${id}-pat`,
    scheduledFor,
    arrivedAt,
    isWalkIn: opts.isWalkIn ?? false,
    durationMinutes: opts.durationMinutes ?? 15,
    status: opts.status,
    patient: { firstName: id, lastName: 'Test', dateOfBirth: null },
    anchor,
  };
}

const NOW = new Date('2026-05-15T10:00:00Z');

describe('classifyAppointments', () => {
  it('marks an in_progress row as current regardless of clock', () => {
    const out = classifyAppointments(
      [
        row('A', { scheduledFor: '2026-05-15T09:00:00Z', status: 'in_progress' }),
        row('B', { scheduledFor: '2026-05-15T10:30:00Z', status: 'scheduled' }),
      ],
      NOW,
    );
    expect(out.find((r) => r.id === 'A')?.position).toBe('current');
    // The next scheduled row picks up `next`.
    expect(out.find((r) => r.id === 'B')?.position).toBe('next');
  });

  it('promotes a scheduled row whose own time window contains now to current', () => {
    const out = classifyAppointments(
      [
        row('A', {
          scheduledFor: '2026-05-15T09:55:00Z',
          status: 'scheduled',
          durationMinutes: 15,
        }),
      ],
      NOW,
    );
    expect(out[0]?.position).toBe('current');
  });

  it("treats an arrived walk-in (anchor past) as 'next' — the patient is waiting", () => {
    const out = classifyAppointments(
      [
        row('walk-1', {
          arrivedAt: '2026-05-15T09:45:00Z',
          isWalkIn: true,
          status: 'arrived',
          durationMinutes: 5,
        }),
      ],
      NOW,
    );
    expect(out[0]?.position).toBe('next');
  });

  it('considers a scheduled row in the future as next only when no current exists', () => {
    const out = classifyAppointments(
      [
        row('past-completed', {
          scheduledFor: '2026-05-15T09:00:00Z',
          status: 'completed',
        }),
        row('future', {
          scheduledFor: '2026-05-15T10:30:00Z',
          status: 'scheduled',
        }),
      ],
      NOW,
    );
    expect(out.find((r) => r.id === 'future')?.position).toBe('next');
    expect(out.find((r) => r.id === 'past-completed')?.position).toBe('past');
  });

  it('puts completed / no_show / cancelled rows in past', () => {
    const out = classifyAppointments(
      [
        row('done', {
          scheduledFor: '2026-05-15T09:00:00Z',
          status: 'completed',
        }),
        row('missed', {
          scheduledFor: '2026-05-15T09:15:00Z',
          status: 'no_show',
        }),
        row('cancelled', {
          scheduledFor: '2026-05-15T09:30:00Z',
          status: 'cancelled',
        }),
      ],
      NOW,
    );
    expect(out.map((r) => r.position)).toEqual(['past', 'past', 'past']);
  });

  it('falls back to past for scheduled rows whose window ended without a transition', () => {
    const out = classifyAppointments(
      [
        row('expired', {
          scheduledFor: '2026-05-15T09:00:00Z',
          status: 'scheduled',
          durationMinutes: 15,
        }),
      ],
      NOW,
    );
    // Window ends at 09:15; now is 10:00 → past.
    expect(out[0]?.position).toBe('past');
  });

  it('emits arrivedAt + isWalkIn + null scheduledFor for walk-in rows', () => {
    const out = classifyAppointments(
      [
        row('walk-1', {
          arrivedAt: '2026-05-15T09:45:00Z',
          isWalkIn: true,
          status: 'arrived',
          durationMinutes: 5,
        }),
      ],
      NOW,
    );
    expect(out[0]).toMatchObject({
      isWalkIn: true,
      scheduledFor: null,
      arrivedAt: '2026-05-15T09:45:00.000Z',
      status: 'arrived',
    });
  });
});
