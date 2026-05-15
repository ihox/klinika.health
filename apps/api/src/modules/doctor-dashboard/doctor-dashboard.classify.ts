// Position classifier for the doctor's home appointment list.
//
// Pure helper kept separate from the service so the classification
// logic can be unit-tested without spinning up Prisma. The service
// hands in the sorted appointment fixtures already merged from
// scheduled bookings + walk-ins (Phase 2b — ADR-011) and the
// classifier assigns `position` ∈ {current, next, upcoming, past} to
// each row according to the rules in the DTO comment.

import type {
  DashboardAppointmentDto,
  DashboardAppointmentStatus,
} from './doctor-dashboard.dto';

export interface ClassifyAppointmentInput {
  id: string;
  patientId: string;
  scheduledFor: Date | null;
  arrivedAt: Date | null;
  isWalkIn: boolean;
  durationMinutes: number;
  status: DashboardAppointmentStatus;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: Date | string | null;
  };
  /** Pre-resolved `scheduledFor ?? arrivedAt` — caller sorts on this. */
  anchor: Date;
}

/**
 * Assign positions and project the public DTO shape. Pre-conditions:
 * `appointments` is sorted by `anchor` ascending. Caller has already
 * narrowed `status` to the dashboard's enum.
 *
 *   `current`  — the single in_progress row, or a scheduled booking
 *                whose own time window contains `now`.
 *   `next`     — first pending unstarted row after current; an
 *                `arrived` walk-in counts even when its anchor has
 *                already passed (the patient is waiting in the room).
 *                A scheduled booking only counts when its anchor is in
 *                the future.
 *   `past`     — completed / cancelled / no_show, or a scheduled
 *                booking whose time window has ended without a
 *                transition.
 *   `upcoming` — everything else still pending.
 */
export function classifyAppointments(
  appointments: ClassifyAppointmentInput[],
  now: Date,
): DashboardAppointmentDto[] {
  const nowMs = now.getTime();

  let currentIndex = appointments.findIndex(
    (a) => a.status === 'in_progress',
  );
  if (currentIndex === -1) {
    currentIndex = appointments.findIndex((a) => {
      if (a.status !== 'scheduled' || a.scheduledFor == null) return false;
      const start = a.scheduledFor.getTime();
      const end = start + a.durationMinutes * 60_000;
      return start <= nowMs && nowMs < end;
    });
  }

  let nextIndex = -1;
  appointments.forEach((a, idx) => {
    if (idx === currentIndex || nextIndex !== -1) return;
    if (a.status === 'arrived') {
      nextIndex = idx;
      return;
    }
    if (a.status === 'scheduled' && a.scheduledFor != null) {
      if (a.scheduledFor.getTime() > nowMs) {
        nextIndex = idx;
      }
    }
  });

  return appointments.map((a, idx) => {
    let position: DashboardAppointmentDto['position'];
    if (idx === currentIndex) {
      position = 'current';
    } else if (idx === nextIndex) {
      position = 'next';
    } else if (
      a.status === 'completed' ||
      a.status === 'cancelled' ||
      a.status === 'no_show'
    ) {
      position = 'past';
    } else if (
      a.status === 'scheduled' &&
      a.scheduledFor != null &&
      a.scheduledFor.getTime() + a.durationMinutes * 60_000 < nowMs
    ) {
      position = 'past';
    } else {
      position = 'upcoming';
    }
    return {
      id: a.id,
      patientId: a.patientId,
      patient: {
        firstName: a.patient.firstName,
        lastName: a.patient.lastName,
        dateOfBirth: serializeDob(a.patient.dateOfBirth),
      },
      scheduledFor: a.scheduledFor ? a.scheduledFor.toISOString() : null,
      arrivedAt: a.arrivedAt ? a.arrivedAt.toISOString() : null,
      isWalkIn: a.isWalkIn,
      durationMinutes: a.durationMinutes,
      status: a.status,
      position,
    };
  });
}

function serializeDob(dob: Date | string | null): string | null {
  if (dob == null) return null;
  if (dob instanceof Date) return dob.toISOString().slice(0, 10);
  return dob;
}
