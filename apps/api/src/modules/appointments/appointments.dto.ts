// Appointment DTOs — receptionist + doctor share the same shape because
// appointments hold no clinical content. Per CLAUDE.md §8 the
// receptionist sees only `firstName`, `lastName`, and `dateOfBirth` of
// the linked patient; AppointmentDto inlines those three patient fields
// (and only those) so the calendar grid can render without a second
// patient lookup, while still respecting the role-1 privacy boundary.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const APPOINTMENT_STATUSES = ['scheduled', 'completed', 'no_show', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
export const AppointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);

// ---------------------------------------------------------------------------
// Range query
// ---------------------------------------------------------------------------

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data duhet VVVV-MM-DD');

// `from` and `to` are inclusive calendar days in Europe/Belgrade. The
// service expands them to a TIMESTAMPTZ range covering full local days.
export const AppointmentRangeQuerySchema = z
  .object({
    from: IsoDateSchema,
    to: IsoDateSchema,
  })
  .strict()
  .refine((v) => v.from <= v.to, {
    message: 'Diapazoni i datave i pavlefshëm',
    path: ['to'],
  });
export type AppointmentRangeQuery = z.infer<typeof AppointmentRangeQuerySchema>;

export const AppointmentStatsQuerySchema = z
  .object({
    date: IsoDateSchema,
  })
  .strict();
export type AppointmentStatsQuery = z.infer<typeof AppointmentStatsQuerySchema>;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const CreateAppointmentSchema = z
  .object({
    patientId: z.string().uuid('Pacienti i pavlefshëm'),
    // Local clock time in Europe/Belgrade. The service combines the date
    // and time into a `TIMESTAMPTZ` so the UI never has to do timezone
    // math.
    date: IsoDateSchema,
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Ora duhet të jetë HH:MM'),
    durationMinutes: z.number().int().min(5).max(180),
  })
  .strict();
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;

// ---------------------------------------------------------------------------
// Update — any subset
// ---------------------------------------------------------------------------

export const UpdateAppointmentSchema = z
  .object({
    date: IsoDateSchema.optional(),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Ora duhet të jetë HH:MM')
      .optional(),
    durationMinutes: z.number().int().min(5).max(180).optional(),
    status: AppointmentStatusSchema.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Asgjë për të përditësuar' });
export type UpdateAppointmentInput = z.infer<typeof UpdateAppointmentSchema>;

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

/**
 * What the calendar grid renders. Patient `firstName` / `lastName` /
 * `dateOfBirth` are inlined to avoid a per-card lookup; this is the
 * full set of patient fields the receptionist may see (CLAUDE.md §1.2,
 * §8). `lastVisitAt` powers the green/yellow/red indicator chip — see
 * `colorIndicatorForLastVisit`. `isNew` is true when the patient has no
 * prior visits.
 */
export interface AppointmentDto {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  scheduledFor: string;
  durationMinutes: number;
  status: AppointmentStatus;
  lastVisitAt: string | null;
  isNewPatient: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentListResponse {
  appointments: AppointmentDto[];
  // Server-stamped wall clock so the client doesn't drift when computing
  // the "now" line and the "next appointment" countdown.
  serverTime: string;
}

export interface AppointmentStatsResponse {
  date: string;
  total: number;
  completed: number;
  noShow: number;
  scheduled: number;
  cancelled: number;
  firstStart: string | null; // ISO of first appt of the day
  lastEnd: string | null; // ISO of last appt's end
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
// Availability (slice-09 booking dialog)
// ---------------------------------------------------------------------------
//
// Given a (date, time) anchor — either tapped on the calendar (Path 1) or
// chosen via the time picker (Path 2) — the dialog asks the server which
// of the clinic's configured durations actually fit. The response drives
// the three states from the design prototype:
//   - `fits`     → clean fit, no warnings
//   - `extends`  → fits but the booking would run past the natural slot
//                  unit (the smallest configured duration) — UI shows the
//                  end time as a calm "Të vazhdojmë?" notice
//   - `blocked`  → conflict or after-hours; option is visually disabled
//
// `excludeAppointmentId` lets the edit flow check against everything
// *except* the appointment being moved, so re-saving an unchanged
// appointment doesn't report itself as a conflict.

export const AppointmentAvailabilityQuerySchema = z
  .object({
    date: IsoDateSchema,
    time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Ora duhet të jetë HH:MM'),
    excludeAppointmentId: z.string().uuid().optional(),
  })
  .strict();
export type AppointmentAvailabilityQuery = z.infer<typeof AppointmentAvailabilityQuerySchema>;

export type AvailabilityStatus = 'fits' | 'extends' | 'blocked';
export type AvailabilityReason = 'closed_day' | 'before_open' | 'after_close' | 'conflict';

export interface AvailabilityOption {
  durationMinutes: number;
  status: AvailabilityStatus;
  endsAt: string | null;
  reason: AvailabilityReason | null;
}

export interface AppointmentAvailabilityResponse {
  date: string;
  time: string;
  /** Smallest configured duration; the UI treats it as the natural slot unit. */
  slotUnitMinutes: number;
  options: AvailabilityOption[];
}

// ---------------------------------------------------------------------------
// Color indicator (CLAUDE.md slice-08 §2)
// ---------------------------------------------------------------------------

export type LastVisitColor = 'green' | 'yellow' | 'red' | null;

/**
 * Color chip rule:
 *   - No prior visit  → null   (no chip)
 *   - 1–7 days ago    → red    (very recent)
 *   - 7–30 days ago   → yellow
 *   - more than 30    → green
 *
 * Boundaries are exclusive on the lower edge of each band so a 7-day
 * gap reads yellow (less alarming) and a 30-day gap reads green.
 * Pure function — re-used in unit tests.
 */
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
