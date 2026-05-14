// Client for the unified visits calendar API (Phase 2a, ADR-011).
//
// Wire shapes mirror `apps/api/src/modules/visits/visits-calendar.dto.ts`
// — keep them aligned. Reuses the date / day-label helpers from
// `appointment-client.ts` so legacy callers don't move around in this
// step (those helpers are pure UI, not tied to the appointments API
// shape).

import { apiFetch, apiUrl } from './api';

// ---------------------------------------------------------------------------
// Lifecycle (full unified set — no narrowing)
// ---------------------------------------------------------------------------

export const VISIT_STATUSES = [
  'scheduled',
  'arrived',
  'in_progress',
  'completed',
  'no_show',
  'cancelled',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/**
 * Mirror of `ALLOWED_TRANSITIONS` from the server. The status menu
 * (Step 5) reads this to compute which menu items to show; the API
 * also gates here on the server.
 */
export const ALLOWED_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  scheduled: ['arrived', 'no_show', 'cancelled'],
  arrived: ['in_progress', 'no_show'],
  in_progress: ['completed'],
  completed: ['arrived'],
  no_show: ['arrived'],
  cancelled: ['arrived'],
};

export function isTransitionAllowed(from: VisitStatus, to: VisitStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface CalendarEntry {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  /** ISO instant; null for walk-ins. */
  scheduledFor: string | null;
  /** Minutes; null for walk-ins. */
  durationMinutes: number | null;
  /** ISO instant when patient arrived; set once status leaves 'scheduled'. */
  arrivedAt: string | null;
  status: VisitStatus;
  isWalkIn: boolean;
  /** Receptionist-only callers always see null (CLAUDE.md §1.2). */
  paymentCode: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  /** ISO yyyy-mm-dd of the patient's most recent completed visit. */
  lastVisitAt: string | null;
  isNewPatient: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarListResponse {
  entries: CalendarEntry[];
  serverTime: string;
}

export interface CalendarStatsResponse {
  date: string;
  total: number;
  scheduled: number;
  walkIn: number;
  completed: number;
  noShow: number;
  cancelled: number;
  arrived: number;
  inProgress: number;
  firstStart: string | null;
  lastEnd: string | null;
  paymentTotalCents: number;
  nextAppointment: {
    id: string;
    patient: { firstName: string; lastName: string; dateOfBirth: string | null };
    scheduledFor: string;
    durationMinutes: number;
  } | null;
}

export interface CreateScheduledVisitInput {
  patientId: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  durationMinutes: number;
}

export interface CreateWalkinVisitInput {
  patientId: string;
  initialStatus?: 'arrived' | 'in_progress';
}

export interface RescheduleVisitInput {
  date?: string;
  time?: string;
  durationMinutes?: number;
}

export type AvailabilityStatus = 'fits' | 'extends' | 'blocked';
export type AvailabilityReason =
  | 'closed_day'
  | 'before_open'
  | 'after_close'
  | 'conflict';

export interface AvailabilityOption {
  durationMinutes: number;
  status: AvailabilityStatus;
  endsAt: string | null;
  reason: AvailabilityReason | null;
}

export interface CalendarAvailabilityResponse {
  date: string;
  time: string;
  slotUnitMinutes: number;
  options: AvailabilityOption[];
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const calendarClient = {
  list: (from: string, to: string) =>
    apiFetch<CalendarListResponse>(
      `/api/visits/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  stats: (date: string) =>
    apiFetch<CalendarStatsResponse>(
      `/api/visits/calendar/stats?date=${encodeURIComponent(date)}`,
    ),

  unmarkedPast: () =>
    apiFetch<{ entries: CalendarEntry[] }>(`/api/visits/calendar/unmarked-past`),

  availability: (params: {
    date: string;
    time: string;
    excludeVisitId?: string;
  }) => {
    const qs = new URLSearchParams({ date: params.date, time: params.time });
    if (params.excludeVisitId) qs.set('excludeVisitId', params.excludeVisitId);
    return apiFetch<CalendarAvailabilityResponse>(
      `/api/visits/calendar/availability?${qs.toString()}`,
    );
  },

  createScheduled: (input: CreateScheduledVisitInput) =>
    apiFetch<{ entry: CalendarEntry }>(`/api/visits/scheduled`, {
      method: 'POST',
      json: input,
    }),

  createWalkin: (input: CreateWalkinVisitInput) =>
    apiFetch<{ entry: CalendarEntry }>(`/api/visits/walkin`, {
      method: 'POST',
      json: input,
    }),

  reschedule: (id: string, input: RescheduleVisitInput) =>
    apiFetch<{ entry: CalendarEntry }>(`/api/visits/${id}/scheduling`, {
      method: 'PATCH',
      json: input,
    }),

  changeStatus: (id: string, status: VisitStatus) =>
    apiFetch<{ entry: CalendarEntry }>(`/api/visits/${id}/status`, {
      method: 'PATCH',
      json: { status },
    }),

  softDelete: (id: string) =>
    apiFetch<{ status: 'ok'; restorableUntil: string }>(
      `/api/visits/calendar/${id}`,
      { method: 'DELETE' },
    ),

  restore: (id: string) =>
    apiFetch<{ entry: CalendarEntry }>(`/api/visits/calendar/${id}/restore`, {
      method: 'POST',
    }),

  streamUrl: () => apiUrl(`/api/visits/calendar/stream`),
};

// ---------------------------------------------------------------------------
// Convenience splitters
// ---------------------------------------------------------------------------

/** Scheduled visits (time-grid entries). Walk-ins go to the band. */
export function isScheduledEntry(e: CalendarEntry): boolean {
  return !e.isWalkIn && e.scheduledFor != null;
}

/** Walk-in entries (`isWalkIn=true`). */
export function isWalkInEntry(e: CalendarEntry): boolean {
  return e.isWalkIn;
}
