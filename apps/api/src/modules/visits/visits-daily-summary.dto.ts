// Daily summary DTOs — the `/raporti` page's data source.
//
// Read-only aggregate of a single local day's visits. Accessible to
// doctor, receptionist, and clinic_admin (the receptionist's access is
// the named carve-out from CLAUDE.md §1.2, per ADR-019); the
// receptionist is server-restricted to today/yesterday.
//
// The response is the single source of truth for the /raporti page on
// screen and the /raporti/print A4 template — both render the same
// shape so the print is always a faithful snapshot of what the screen
// showed.

import { z } from 'zod';

import { VisitStatusSchema, type VisitStatus } from './visits-calendar.dto';

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data e pavlefshme');

export const DailySummaryQuerySchema = z
  .object({
    date: isoDate,
  })
  .strict();

export type DailySummaryQuery = z.infer<typeof DailySummaryQuerySchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type StatusBreakdown = Record<VisitStatus, number>;

/**
 * A single visit row on the daily report. The shape is intentionally
 * narrower than `VisitDto` — only what the screen + print template
 * render. No clinical free-text, no diagnoses; the report is
 * operational, not chart-level.
 *
 * `paymentCode` and `paymentAmountCents` are resolved server-side from
 * `clinic.paymentCodes` (the JSON keyed by A/B/C/D/E). The amount is
 * `null` for rows whose payment code is missing OR whose status is not
 * `completed` (the doctor hasn't finished the visit yet, so no cash
 * was collected).
 *
 * `time` is the local-day clock the receptionist would file the visit
 * under: `scheduled_for` for bookings, `arrived_at` for walk-ins, and
 * a fallback to `created_at` for the rare standalone with neither.
 *
 * `isFirstVisit` is true iff this row's `visit_date` equals the
 * patient's MIN(visit_date) for the clinic, ignoring soft-deleted
 * rows. Used for the "Vizita e parë" annotation on the print.
 */
export interface DailySummaryVisitDto {
  id: string;
  /** Local HH:mm in Europe/Belgrade. */
  time: string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    /** ISO date string (YYYY-MM-DD) or null when DOB is the orphan sentinel. */
    dateOfBirth: string | null;
  };
  status: VisitStatus;
  isWalkIn: boolean;
  paymentCode: 'A' | 'B' | 'C' | 'D' | 'E' | null;
  paymentAmountCents: number | null;
  isFirstVisit: boolean;
}

/**
 * Top-level response for `GET /api/visits/daily-summary?date=…`.
 *
 * `paidCount` is the number of rows that contributed cash to
 * `totalRevenueCents` (status === 'completed' AND paymentCode in
 * {A,B,C,D} — the four paid codes; E=Falas is excluded).
 *
 * `paymentCodeBreakdown` is a per-code count + cents tally, ordered
 * A→E for stable rendering, including codes the clinic configured
 * but didn't use today (count: 0, totalCents: 0). The screen's
 * foot-note + the print's foot-note both read this verbatim.
 *
 * `paymentCodes` echoes the clinic's full code catalogue (label +
 * amountCents) so the print's bottom legend can render without a
 * second round-trip.
 */
export interface DailySummaryResponse {
  date: string;
  totalRevenueCents: number;
  visitCount: number;
  statusBreakdown: StatusBreakdown;
  paidCount: number;
  paymentCodeBreakdown: PaymentCodeBreakdownEntry[];
  paymentCodes: PaymentCodeCatalogueEntry[];
  visits: DailySummaryVisitDto[];
}

export interface PaymentCodeBreakdownEntry {
  code: string;
  label: string;
  amountCents: number;
  count: number;
  totalCents: number;
}

export interface PaymentCodeCatalogueEntry {
  code: string;
  label: string;
  amountCents: number;
}

// ---------------------------------------------------------------------------
// Helpers — exported for tests
// ---------------------------------------------------------------------------

export const EMPTY_STATUS_BREAKDOWN: StatusBreakdown = {
  scheduled: 0,
  arrived: 0,
  in_progress: 0,
  completed: 0,
  no_show: 0,
};

/**
 * Codes that count toward `totalRevenueCents` and `paidCount`. E
 * (Falas) is excluded — the patient was seen but charged nothing, so
 * including E would inflate the paid-count vs. the revenue total.
 * Matches the print template's foot-note copy "18 të paguara · 5 të
 * tjera" (paid + other = total).
 */
export const PAID_CODES = ['A', 'B', 'C', 'D'] as const;
export type PaidCode = (typeof PAID_CODES)[number];

export { VisitStatusSchema };
