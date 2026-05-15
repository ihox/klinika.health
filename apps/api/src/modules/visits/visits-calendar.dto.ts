// Calendar DTOs — the receptionist's calendar surface plus the doctor's
// real-time stream.
//
// Phase 2a replaces the appointments translation layer. Visits and
// appointments are one table now (ADR-011); the calendar surface returns
// the full lifecycle status set and exposes walk-in metadata directly,
// no narrowing.
//
// Receptionist privacy boundary (CLAUDE.md §1.2) is preserved: every
// entry carries only `firstName`, `lastName`, `dateOfBirth` of the linked
// patient.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status lifecycle
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
export const VisitStatusSchema = z.enum(VISIT_STATUSES);

/**
 * Allowed status transitions. The keys are the current state; values are
 * the states the row may transition into.
 *
 *   scheduled  → arrived | no_show | cancelled
 *   arrived    → in_progress | no_show
 *   in_progress → completed
 *   completed  → arrived           (Phase 2c "Pastro vizitën")
 *   no_show    → arrived           ("Rikthe te paraqitur" — patient did show up after all)
 *   cancelled  → arrived           ("Rikthe te paraqitur" — booking restored)
 *
 * Anything not listed is rejected with HTTP 400 and reason='invalid_transition'.
 */
export const ALLOWED_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  scheduled: ['arrived', 'no_show', 'cancelled'],
  // arrived → completed (Phase 2b): the doctor's home "Shëno si kryer"
  // quick-action closes a visit straight from `arrived` when the
  // doctor confirms the patient was seen without going through an
  // explicit `in_progress` flip on the receptionist side. The chart
  // form still owns the canonical arrived→in_progress→completed flow.
  arrived: ['in_progress', 'completed', 'no_show'],
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
// Clinical-data guard — used by the calendar delete endpoint.
// ---------------------------------------------------------------------------
//
// A receptionist may soft-delete a row from the calendar surface only if
// the row has no clinical content. "Has clinical data" is any of:
// complaint, examinations, prescription, ultrasoundNotes, labResults,
// followupNotes, otherNotes, legacyDiagnosis, feedingNotes, weightG,
// heightCm, headCircumferenceCm, temperatureC, paymentCode, OR any
// linked structured diagnoses. If clinical data exists, deletion is 403
// with the message below and the doctor must use the chart-form "Pastro
// vizitën" affordance (Phase 2c).

export interface ClinicalDataSnapshot {
  complaint: string | null;
  examinations: string | null;
  prescription: string | null;
  ultrasoundNotes: string | null;
  labResults: string | null;
  followupNotes: string | null;
  otherNotes: string | null;
  legacyDiagnosis: string | null;
  feedingNotes: string | null;
  weightG: number | null;
  heightCm: unknown;
  headCircumferenceCm: unknown;
  temperatureC: unknown;
  paymentCode: string | null;
  diagnosesCount?: number;
}

export const CLINICAL_DATA_REFUSAL_MESSAGE =
  'Vizita ka të dhëna klinike. Pastro përmes formularit të mjekut.';

export function hasClinicalData(v: ClinicalDataSnapshot): boolean {
  if (nonEmptyString(v.complaint)) return true;
  if (nonEmptyString(v.examinations)) return true;
  if (nonEmptyString(v.prescription)) return true;
  if (nonEmptyString(v.ultrasoundNotes)) return true;
  if (nonEmptyString(v.labResults)) return true;
  if (nonEmptyString(v.followupNotes)) return true;
  if (nonEmptyString(v.otherNotes)) return true;
  if (nonEmptyString(v.legacyDiagnosis)) return true;
  if (nonEmptyString(v.feedingNotes)) return true;
  if (v.weightG != null) return true;
  if (v.heightCm != null) return true;
  if (v.headCircumferenceCm != null) return true;
  if (v.temperatureC != null) return true;
  if (nonEmptyString(v.paymentCode)) return true;
  if ((v.diagnosesCount ?? 0) > 0) return true;
  return false;
}

function nonEmptyString(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Query schemas
// ---------------------------------------------------------------------------

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data duhet VVVV-MM-DD');

const TimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Ora duhet të jetë HH:MM');

// Scheduling-specific time schema — same shape as TimeSchema plus a
// 5-minute boundary refinement. Applied to Create/Update/Reschedule
// only; availability queries keep the looser TimeSchema so they can
// still accept finer-grained "starting from" times.
const SchedulingTimeSchema = TimeSchema.refine(
  (s) => {
    const [, m] = s.split(':');
    return Number(m) % 5 === 0;
  },
  { message: 'Ora duhet të jetë në hapa 5-minutësh' },
);

// `from` and `to` are inclusive calendar days in Europe/Belgrade.
export const CalendarRangeQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    message: 'Diapazoni i datave i pavlefshëm',
    path: ['to'],
  });
export type CalendarRangeQuery = z.infer<typeof CalendarRangeQuerySchema>;

export const CalendarStatsQuerySchema = z
  .object({
    date: IsoDateSchema,
  })
  .strict();
export type CalendarStatsQuery = z.infer<typeof CalendarStatsQuerySchema>;

export const CalendarAvailabilityQuerySchema = z
  .object({
    date: IsoDateSchema,
    time: TimeSchema,
    excludeVisitId: z.string().uuid().optional(),
  })
  .strict();
export type CalendarAvailabilityQuery = z.infer<typeof CalendarAvailabilityQuerySchema>;

// ---------------------------------------------------------------------------
// Mutation schemas
// ---------------------------------------------------------------------------

// Receptionist-side scheduled booking.
export const CreateScheduledVisitSchema = z
  .object({
    patientId: z.string().uuid('Pacienti i pavlefshëm'),
    date: IsoDateSchema,
    time: SchedulingTimeSchema,
    durationMinutes: z.number().int().min(5).max(180),
  })
  .strict();
export type CreateScheduledVisitInput = z.infer<typeof CreateScheduledVisitSchema>;

// Walk-in: no time, no duration, just the patient and a pairing.
//
// `initialStatus` defaults to 'arrived' (receptionist registers the
// patient, doctor will see them shortly). The receptionist may also
// open with 'in_progress' when the doctor takes the patient straight
// in without a waiting-room stop. Those are the only two valid initial
// states for a walk-in (CLAUDE.md status-lifecycle).
//
// `pairedWithVisitId` is REQUIRED — a walk-in always pairs with a
// scheduled visit per the operational rule (CLAUDE.md §13, ADR-011).
// The service validates that the paired visit is in the same clinic,
// is not soft-deleted, has `scheduledFor !== null` (i.e. it's a
// booking, not another walk-in), and is not finalized as completed.
// The DB-level CHECK constraint locks down the "only walk-ins may
// claim a pairing" half of the invariant.
export const WALKIN_PAIRING_REFUSAL_MESSAGE =
  "Termini nuk u gjet ose nuk është për pacient pa termin";

export const CreateWalkinVisitSchema = z
  .object({
    patientId: z.string().uuid('Pacienti i pavlefshëm'),
    pairedWithVisitId: z.string().uuid('Termini i çiftëzimit i pavlefshëm'),
    initialStatus: z.enum(['arrived', 'in_progress']).optional(),
  })
  .strict();
export type CreateWalkinVisitInput = z.infer<typeof CreateWalkinVisitSchema>;

// Reschedule a scheduled visit (date/time/duration). Cannot be used on
// walk-ins — the controller rejects with `reason: 'walkin_immovable'`.
export const UpdateScheduledVisitSchema = z
  .object({
    date: IsoDateSchema.optional(),
    time: SchedulingTimeSchema.optional(),
    durationMinutes: z.number().int().min(5).max(180).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Asgjë për të përditësuar',
  });
export type UpdateScheduledVisitInput = z.infer<typeof UpdateScheduledVisitSchema>;

// Status-only transition. Strictly validated against ALLOWED_TRANSITIONS.
export const UpdateVisitStatusSchema = z
  .object({
    status: VisitStatusSchema,
  })
  .strict();
export type UpdateVisitStatusInput = z.infer<typeof UpdateVisitStatusSchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

/**
 * One row in the receptionist's calendar feed. Includes scheduled
 * bookings and walk-ins. Patient fields are limited to name + DOB per
 * the receptionist privacy boundary.
 */
export interface CalendarEntryDto {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  /** ISO instant (UTC), or null for walk-ins. */
  scheduledFor: string | null;
  /** Minutes; null for walk-ins. */
  durationMinutes: number | null;
  /** ISO instant (UTC) when the patient arrived; set for status >= 'arrived'. */
  arrivedAt: string | null;
  status: VisitStatus;
  isWalkIn: boolean;
  /**
   * Billing tier letter on completed visits. Always `null` for
   * receptionist-only callers per CLAUDE.md §1.2 ("no payment codes").
   * Populated only when the caller holds doctor or clinic_admin and the
   * visit has a code on file. Day-level totals live in
   * `/calendar/stats.paymentTotalCents` (the aggregate is non-PHI).
   */
  paymentCode: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  /** ISO yyyy-mm-dd of the patient's most recent completed visit, or null. */
  lastVisitAt: string | null;
  isNewPatient: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarListResponse {
  entries: CalendarEntryDto[];
  /** Server-stamped wall clock so the client doesn't drift. */
  serverTime: string;
}

export interface CalendarStatsResponse {
  date: string;
  /** Total visits today (scheduled + walk-in, any status, excluding deleted). */
  total: number;
  /** Scheduled visits today (status='scheduled'). */
  scheduled: number;
  /** Walk-ins today (is_walk_in=true, any status). */
  walkIn: number;
  completed: number;
  noShow: number;
  cancelled: number;
  arrived: number;
  inProgress: number;
  /** First start (any visit) of the day as ISO instant. */
  firstStart: string | null;
  /** Last end (start + duration for bookings; arrived_at for walk-ins) of the day. */
  lastEnd: string | null;
  /** Sum of completed visits' payment codes in cents. */
  paymentTotalCents: number;
  /** Earliest still-scheduled future visit on this date. */
  nextAppointment: {
    id: string;
    patient: { firstName: string; lastName: string; dateOfBirth: string | null };
    scheduledFor: string;
    durationMinutes: number;
  } | null;
}

export interface SoftDeleteResponse {
  status: 'ok';
  restorableUntil: string;
}

// ---------------------------------------------------------------------------
// Availability (booking dialog)
// ---------------------------------------------------------------------------

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
// Color indicator (mirrors slice-08 helper)
// ---------------------------------------------------------------------------

export type LastVisitColor = 'green' | 'yellow' | 'red' | null;

export function colorIndicatorForLastVisit(
  lastVisitAt: string | Date | null,
  asOf: Date = new Date(),
): LastVisitColor {
  if (lastVisitAt == null) return null;
  const last = typeof lastVisitAt === 'string' ? new Date(lastVisitAt) : lastVisitAt;
  if (Number.isNaN(last.getTime())) return null;
  const ms = asOf.getTime() - last.getTime();
  if (ms < 0) return null;
  const days = ms / 86_400_000;
  if (days <= 7) return 'red';
  if (days <= 30) return 'yellow';
  return 'green';
}
