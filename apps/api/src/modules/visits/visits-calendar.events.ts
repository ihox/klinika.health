// Lightweight in-process event bus for the calendar's SSE channel.
//
// One process is enough for v1 (single-node deployment per ADR-002).
// When that changes, swap this for pg-notify against the same
// emit/subscribe shape.
//
// Events are visit.* and cover the calendar lifecycle:
//   - visit.created          — new scheduled booking OR walk-in row
//   - visit.updated          — booking moved (date/time/duration)
//   - visit.status_changed   — status transition (scheduled→arrived, etc.)
//   - visit.deleted          — soft-delete
//   - visit.restored         — soft-deleted row restored (30s undo)
//   - visit.walkin.added     — Phase 2b — secondary signal for walk-in
//                              creation, carrying the patient name and
//                              actor id so the doctor's home can toast
//                              an arrival without re-fetching first.
//                              Fires *in addition to* visit.created.
// The doctor's home dashboard subscribes to the same stream so a
// receptionist-side change re-fetches the dashboard in real time.

import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export type VisitCalendarEventType =
  | 'visit.created'
  | 'visit.updated'
  | 'visit.status_changed'
  | 'visit.deleted'
  | 'visit.restored'
  | 'visit.walkin.added';

export interface VisitCalendarEvent {
  type: VisitCalendarEventType;
  clinicId: string;
  visitId: string;
  /**
   * ISO yyyy-mm-dd of the local day this visit anchors to:
   *   - bookings — scheduled_for::date in Europe/Belgrade
   *   - walk-ins — arrived_at::date in Europe/Belgrade
   * Clients use this to decide whether their visible range is affected.
   */
  localDate: string;
  isWalkIn: boolean;
  status: string;
  /** For visit.status_changed only. */
  previousStatus?: string;
  emittedAt: string;

  // ---- Set only on `visit.walkin.added` (Phase 2b) ----
  /**
   * User ID of the actor who created the walk-in. Subscribers compare
   * against their own session user to skip self-notifications (the
   * caller already sees the new row through the POST response).
   */
  actorUserId?: string;
  /**
   * Patient display name for the arrival toast. The clinic SSE stream
   * is authenticated and tenant-scoped (CLAUDE.md §1.6); a transient
   * patient name in the response body to an authorized clinical user
   * is acceptable for the real-time notification. The pino redaction
   * filter still scrubs the field if it ever lands in operational
   * logs (defense in depth).
   */
  patientName?: string;
  /** Booking the walk-in is paired to. */
  pairedWithVisitId?: string | null;
}

@Injectable()
export class VisitsCalendarEventsService {
  private readonly bus = new EventEmitter();

  constructor() {
    // The default of 10 listeners is fine; we bump it so several
    // receptionist tabs + the doctor's dashboard can all subscribe
    // without Node logging a noisy-warning during a busy day.
    this.bus.setMaxListeners(50);
  }

  emit(event: VisitCalendarEvent): void {
    this.bus.emit('event', event);
  }

  /**
   * Subscribe to clinic-scoped events. Returns the unsubscribe function.
   * Per CLAUDE.md §1.6 we filter by `clinicId` here so the SSE channel
   * can never deliver a different tenant's event even if a controller
   * bug forgets to pass the scope down.
   */
  subscribe(
    clinicId: string,
    handler: (event: VisitCalendarEvent) => void,
  ): () => void {
    const wrapped = (event: VisitCalendarEvent): void => {
      if (event.clinicId !== clinicId) return;
      handler(event);
    };
    this.bus.on('event', wrapped);
    return () => {
      this.bus.off('event', wrapped);
    };
  }
}
