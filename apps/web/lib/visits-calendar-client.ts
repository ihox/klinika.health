// Client for the unified visits calendar API (Phase 2a, ADR-011).
//
// Wire shapes mirror `apps/api/src/modules/visits/visits-calendar.dto.ts`
// — keep them aligned. Reuses the date / day-label helpers from
// `appointment-client.ts` so legacy callers don't move around in this
// step (those helpers are pure UI, not tied to the appointments API
// shape).

import { apiFetch, apiUrl } from './api';
import { toLocalParts } from './appointment-client';

// ---------------------------------------------------------------------------
// Lifecycle (full unified set — no narrowing)
// ---------------------------------------------------------------------------

export const VISIT_STATUSES = [
  'scheduled',
  'arrived',
  'in_progress',
  'completed',
  'no_show',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/**
 * Mirror of `ALLOWED_TRANSITIONS` from the server. The status menu
 * (Step 5) reads this to compute which menu items to show; the API
 * also gates here on the server.
 */
export const ALLOWED_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  scheduled: ['arrived', 'no_show'],
  arrived: ['in_progress', 'no_show'],
  in_progress: ['completed'],
  completed: ['arrived'],
  no_show: ['arrived'],
};

export function isTransitionAllowed(from: VisitStatus, to: VisitStatus): boolean {
  if (from === to) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Statuses the receptionist UI offers as pairing targets for a walk-in.
 * The server-side rule (visits-calendar.service.ts createWalkin) is
 * laxer — it only rejects `completed`. The UI is more conservative on
 * purpose: pairing to a `no_show` row is technically allowed by the
 * server (the row has scheduled_for set, and isn't finalized as
 * completed) but doesn't match the operational picture ("a patient
 * who arrives while another is being seen"). Hiding those rows in the
 * per-row hover + skipping them in the toolbar `[+ Pa termin]`
 * closest-pairing keeps the UI from suggesting pairings that would
 * technically succeed but feel off.
 */
export const PAIRABLE_STATUSES: ReadonlySet<VisitStatus> = new Set<VisitStatus>([
  'scheduled',
  'arrived',
  'in_progress',
]);

/**
 * Pick the scheduled visit a toolbar `[+ Pa termin]` click should pair
 * to, given the entries the receptionist can see and the current wall
 * time. Picks:
 *   1. A visit currently in progress (scheduled_for ≤ now ≤
 *      scheduled_for + duration), or
 *   2. The scheduled-only visit whose scheduled_for is closest to now.
 *      Tie-broken by preferring the past visit (just-passed slot is
 *      the more natural "the doctor's still in the room").
 * Returns null when no pairable visit exists.
 */
export function findClosestPairing(
  entries: ReadonlyArray<CalendarEntry>,
  nowMs: number,
): CalendarEntry | null {
  let inFlight: CalendarEntry | null = null;
  let closest: CalendarEntry | null = null;
  let smallestDiff = Number.POSITIVE_INFINITY;

  for (const e of entries) {
    if (e.isWalkIn) continue;
    if (e.scheduledFor == null) continue;
    if (!PAIRABLE_STATUSES.has(e.status)) continue;
    const start = new Date(e.scheduledFor).getTime();
    if (Number.isNaN(start)) continue;
    const duration = e.durationMinutes ?? 0;
    if (duration > 0 && start <= nowMs && nowMs <= start + duration * 60_000) {
      inFlight = e;
      // Keep scanning in case another in-flight visit starts earlier
      // (rare overlap), but the first match is a fine choice.
    }
    const diff = Math.abs(start - nowMs);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closest = e;
    } else if (
      diff === smallestDiff &&
      closest &&
      start <= nowMs &&
      new Date(closest.scheduledFor!).getTime() > nowMs
    ) {
      closest = e;
    }
  }
  return inFlight ?? closest;
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
  /**
   * Standalone visits today (ADR-013) — invisible to the calendar
   * feed but contributing to `completed`/`paymentTotalCents`.
   */
  standaloneCount: number;
  completed: number;
  noShow: number;
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
  /**
   * UUID of the scheduled visit this walk-in is paired with. Server
   * validates that the visit exists, is in the same clinic, is not
   * soft-deleted, has `scheduledFor !== null`, and is in an active
   * status (scheduled / arrived / in_progress). Omitting it lets the
   * server pick the closest match — used by the toolbar `[+ Pa termin]`
   * flow where the receptionist hasn't picked a specific row.
   */
  pairedWithVisitId?: string;
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

// ---------------------------------------------------------------------------
// Receptionist edit-lock — frontend mirror of
// `apps/api/src/modules/visits/visits-calendar.lock.ts`. The server is
// authoritative; the UI uses this predicate to disable affordances
// proactively so the receptionist doesn't click into a 403/400.
// ---------------------------------------------------------------------------

/**
 * Albanian copy for the receptionist's "this card is locked" tooltip
 * + the rejection toast. Shared so both surfaces stay aligned with the
 * server messages.
 */
export const LOCKED_HOVER_MESSAGE = 'Vizita është e mbyllur';

/**
 * True iff a visit is locked from receptionist edits. Doctor and
 * clinic_admin are never restricted — call sites must gate on the
 * session's roles via `isReceptionistOnlyRole` before applying this
 * predicate.
 *
 * Lock rule (mirrors the server):
 *   - visitDate < today (any status)        → locked
 *   - visitDate === today AND completed     → locked
 *   - everything else                        → unlocked
 *
 * `todayIso` is `YYYY-MM-DD` in `Europe/Belgrade`, computed once per
 * tick by the parent (it already maintains a `todayIso` for the now-
 * line). We use the entry's anchor instant (scheduled or arrived) to
 * derive its LOCAL day via the same `toLocalParts` helper the rest of
 * the calendar uses, so a walk-in arriving at 00:30 Belgrade time near
 * the DST boundary lands on the right column — and the lock predicate
 * agrees with what the receptionist actually sees in the grid.
 */
export function isVisitLockedForReceptionist(
  entry: CalendarEntry,
  todayIso: string,
): boolean {
  const anchorIso = entry.scheduledFor ?? entry.arrivedAt ?? entry.createdAt;
  if (!anchorIso) return false;
  const visitDate = toLocalParts(new Date(anchorIso)).date;
  if (visitDate < todayIso) return true;
  if (visitDate === todayIso && entry.status === 'completed') return true;
  return false;
}

/**
 * Receptionist-only predicate mirroring the backend
 * `isReceptionistOnly`. A user with roles ['receptionist', 'doctor']
 * is NOT receptionist-only and thus NEVER locked — they keep their
 * doctor edit capabilities.
 */
export function isReceptionistOnlyRole(
  roles: ReadonlyArray<string> | null | undefined,
): boolean {
  if (!roles || roles.length === 0) return false;
  if (roles.includes('doctor') || roles.includes('clinic_admin')) return false;
  return roles.includes('receptionist');
}
