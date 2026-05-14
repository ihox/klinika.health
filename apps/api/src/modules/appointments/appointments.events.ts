// Lightweight in-process event bus for appointment SSE.
//
// One process is enough for v1 — the single-node deployment is locked
// in (ADR-002), and on-premise installs run a single container too.
// When that changes (multi-node), we'll swap this for pg-notify against
// the same `emit`/`subscribe` shape.

import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'node:events';

export interface AppointmentEvent {
  type: 'appointment.created' | 'appointment.updated' | 'appointment.deleted';
  clinicId: string;
  appointmentId: string;
  // ISO yyyy-mm-dd of the local day this appointment is on. Clients use
  // this to decide whether to refetch their current visible range
  // without holding a per-client filter on the server side.
  scheduledForDate: string;
  emittedAt: string;
}

@Injectable()
export class AppointmentsEventsService {
  private readonly bus = new EventEmitter();

  constructor() {
    // The default of 10 listeners is fine; we set a slightly higher
    // ceiling to silence the noisy-warning when the doctor and several
    // receptionists are subscribed simultaneously during a busy day.
    this.bus.setMaxListeners(50);
  }

  emit(event: AppointmentEvent): void {
    this.bus.emit('event', event);
  }

  /**
   * Subscribe to clinic-scoped events. Returns the unsubscribe function.
   * Per CLAUDE.md §1.6 we filter by `clinicId` here so the SSE channel
   * can never deliver a different tenant's event even if a controller
   * bug forgets to pass the scope down.
   */
  subscribe(clinicId: string, handler: (event: AppointmentEvent) => void): () => void {
    const wrapped = (event: AppointmentEvent): void => {
      if (event.clinicId !== clinicId) return;
      handler(event);
    };
    this.bus.on('event', wrapped);
    return () => {
      this.bus.off('event', wrapped);
    };
  }
}
