// Doctor dashboard DTOs.
//
// The "Pamja e ditës" home screen consolidates everything Dr. Shala
// needs at a glance: the day's appointment list, the next-patient
// preview card, today's completed-visit log, and a few aggregate
// stats. It's doctor-only — the receptionist has her own calendar
// and would not see the chart-relevant fields here (alergjiTjera,
// diagnoses, payment amounts).
//
// The whole bundle is served in one round-trip per refresh so the
// dashboard can poll a single endpoint (the prototype refreshes
// every 60 seconds). Per CLAUDE.md §1.2 nothing here crosses into
// the receptionist's surface — the controller is `@Roles('doctor',
// 'clinic_admin')` and the data shape includes fields receptionists
// must never see.

import { z } from 'zod';

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data duhet VVVV-MM-DD');

export const DashboardQuerySchema = z
  .object({
    /**
     * Local-day override for testing — production callers omit it and
     * the server resolves to "today in Europe/Belgrade". The schema
     * accepts the override only because the integration tests need
     * deterministic dates against seeded data.
     */
    date: IsoDateSchema.optional(),
  })
  .strict();
export type DashboardQuery = z.infer<typeof DashboardQuerySchema>;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

export type DashboardAppointmentStatus =
  | 'scheduled'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'no_show'
  | 'cancelled';

/**
 * The slim row in `appointments[]`.
 *
 * Phase 2b — walk-ins are folded into this list alongside scheduled
 * bookings. They differ in three places:
 *   - `scheduledFor` is null (no booking), `arrivedAt` is set
 *   - `isWalkIn === true`
 *   - status passes through 'arrived' → 'in_progress' → 'completed'
 *     rather than 'scheduled' → 'completed'
 *
 * Consumers sort by the anchor `scheduledFor ?? arrivedAt`.
 */
export interface DashboardAppointmentDto {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  /** ISO instant of the booked time, or null for walk-ins. */
  scheduledFor: string | null;
  /** ISO instant of patient arrival; set for walk-ins and for scheduled
   *  bookings that have transitioned to status >= 'arrived'. */
  arrivedAt: string | null;
  durationMinutes: number;
  isWalkIn: boolean;
  status: DashboardAppointmentStatus;
  /**
   * `current` — status === 'in_progress' OR (status === 'scheduled' and
   *             anchor <= now < anchor + duration). Highlights "Tani".
   * `next`    — earliest still-unstarted row (status in {scheduled,
   *             arrived}) whose anchor is in the future, OR an arrived
   *             walk-in whose anchor has passed but who hasn't been
   *             seen yet (patient is waiting in the room).
   * `past`    — done/cancelled/no-show, or scheduled with the time
   *             window already ended.
   * `upcoming`— any other still-pending row.
   */
  position: 'current' | 'next' | 'upcoming' | 'past';
}

/** Today's completed-visit log row. */
export interface DashboardVisitLogEntry {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  /** ISO timestamp of `createdAt` — the visit's wall-clock save time. */
  recordedAt: string;
  /** Primary diagnosis (icd10 code + Latin description) or null. */
  primaryDiagnosis: {
    code: string;
    latinDescription: string;
  } | null;
  /** Single-letter payment code (E/A/B/C/D) or null. */
  paymentCode: string | null;
  /** Resolved amount in cents at the time the dashboard was rendered. */
  paymentAmountCents: number | null;
}

/** The next-patient card on the right. */
export interface DashboardNextPatientCard {
  appointmentId: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    sex: 'm' | 'f' | null;
  };
  /**
   * Time anchor for the card's hero clock. For scheduled bookings,
   * this is the booked time. For walk-in targets (Phase 2b), this is
   * the arrival time — keeps the card's existing rendering working
   * without a second time field.
   */
  scheduledFor: string;
  /** True when the upcoming patient is a walk-in (no booking). */
  isWalkIn: boolean;
  durationMinutes: number;
  /** Total visits on file for this patient. */
  visitCount: number;
  /** ISO yyyy-mm-dd of the most recent visit, or null. */
  lastVisitDate: string | null;
  /** Days since the most recent visit, computed at request time. */
  daysSinceLastVisit: number | null;
  /** Last diagnosis (code + Latin description) or null. */
  lastDiagnosis: {
    code: string;
    latinDescription: string;
  } | null;
  /** Last recorded weight (grams) — drives the "X.X kg" tile. */
  lastWeightG: number | null;
  /**
   * Doctor-only safety flag: when the patient has any `alergjiTjera`
   * text on file, this surfaces the warning chip on the next-patient
   * card. The string itself is never sent to the dashboard payload —
   * the doctor sees the full text when they open the chart. We send
   * a boolean here so a future maintainer who adds a wider audience
   * to this endpoint can't accidentally leak the contents.
   */
  hasAllergyNote: boolean;
}

/**
 * "Vizita të hapura" — `in_progress` visits the doctor started on a
 * previous local day but never finished. Surfaced at the top of the
 * dashboard so abandoned charts can be completed (or deleted) before
 * the day's appointments start.
 *
 * The dashboard's existing `appointments` list already covers today's
 * `in_progress` rows; this list is strictly the prior-day backlog
 * (`visit_date < today` in Europe/Belgrade).
 */
export interface DashboardOpenVisitEntry {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  /** ISO `YYYY-MM-DD` of the visit's local-day anchor. */
  visitDate: string;
  /** Whole days between `visitDate` and today (always ≥ 1). */
  daysAgo: number;
}

export interface DashboardStats {
  /** Visits actually entered by the doctor for the day. */
  visitsCompleted: number;
  /**
   * Total visits on the local day (any status, excluding deleted) —
   * **clinical scope**: counts every shape on `visit_date=today`
   * (scheduled bookings, walk-ins, AND standalones). Matches the
   * receptionist's `/calendar/stats.total` by construction so the two
   * views report the same day total. (Pre-PR-2 of cross-view parity
   * this was calendar-scope and excluded standalones; doctor and
   * receptionist totals could disagree by the number of standalone
   * rows.)
   */
  appointmentsTotal: number;
  /**
   * Visits on the local day with status `completed` — **clinical
   * scope**. Equals `visitsCompleted` by construction; retained as a
   * separate field for backward-compatibility with consumers. A future
   * refactor could collapse the two.
   */
  appointmentsCompleted: number;
  /**
   * Average minutes per completed visit, derived from the gaps
   * between consecutive `createdAt` timestamps on today's visits.
   * Null when fewer than two visits have been entered.
   */
  averageVisitMinutes: number | null;
  /** Total cents collected today, summed from each visit's payment code. */
  paymentsCents: number;
}

export interface DoctorDashboardResponse {
  /** Server-resolved local date (Europe/Belgrade) the dashboard reflects. */
  date: string;
  /** Wall-clock when the snapshot was assembled, ISO. */
  serverTime: string;
  appointments: DashboardAppointmentDto[];
  todayVisits: DashboardVisitLogEntry[];
  /**
   * `in_progress` visits from days prior to `date`. Empty array when
   * none — the frontend hides the section rather than rendering an
   * empty card.
   */
  openVisits: DashboardOpenVisitEntry[];
  nextPatient: DashboardNextPatientCard | null;
  stats: DashboardStats;
}
