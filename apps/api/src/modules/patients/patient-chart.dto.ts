// Patient chart DTO — the doctor's full clinical view for a single
// patient. Shipped by `GET /api/patients/:id/chart`, which returns
// the master record alongside the visit timeline and the issued
// vërtetime list so the chart shell can render in one round-trip.
//
// This endpoint is doctor / clinic-admin only (the visit timeline is
// PHI per CLAUDE.md §1.2). The receptionist's bookings flow uses the
// public DTO from patients.dto.ts.
//
// Keep the response shape lean: the chart UI lazy-loads heavier
// resources (DICOM thumbnails, WHO chart data) in later slices. What
// ships here is the data the master strip, visit nav, history list,
// and vërtetime list all need to render immediately.

import type { PatientFullDto } from './patients.dto';

export interface ChartVisitDto {
  id: string;
  visitDate: string;
  /**
   * Lifecycle status. Used by the chart shell to identify today's
   * active visit (scheduled/arrived/in_progress) so the form mounts
   * on it and the "+ Vizitë e re" button knows whether to hide.
   */
  status: string;
  primaryDiagnosis: {
    code: string;
    latinDescription: string;
  } | null;
  /** Free-text legacy diagnosis from the pre-migration Access source. */
  legacyDiagnosis: string | null;
  paymentCode: string | null;
  /** ISO of the most recent server-side update — used for cache busting. */
  updatedAt: string;
}

export interface ChartVertetimDto {
  id: string;
  visitId: string;
  issuedAt: string;
  absenceFrom: string;
  absenceTo: string;
  /** Number of calendar days inclusive (`absenceTo - absenceFrom + 1`). */
  durationDays: number;
  /** Frozen diagnosis snapshot from the moment of issue. */
  diagnosisSnapshot: string;
}

/**
 * A single growth-chart measurement point. Each row corresponds to a
 * saved (non-deleted) visit that recorded at least one of weight,
 * height, or head circumference. Slice 14 plots these against WHO
 * percentile reference curves.
 *
 * `ageMonths` is the patient's age at `visitDate`, rounded down to
 * whole months — the WHO chart's x-axis. The frontend filters points
 * to the 0–24 month band for the standard chart and offers the
 * "historik 0–24 muaj" view for older patients with infancy data.
 *
 * `weightKg`, `heightCm`, `headCircumferenceCm` are the canonical
 * units the UI plots — the API converts from the stored integer
 * grams so the frontend doesn't have to know about the storage unit.
 */
export interface ChartGrowthPointDto {
  visitId: string;
  visitDate: string;
  ageMonths: number;
  weightKg: number | null;
  heightCm: number | null;
  headCircumferenceCm: number | null;
}

export interface PatientChartDto {
  patient: PatientFullDto;
  visits: ChartVisitDto[];
  vertetime: ChartVertetimDto[];
  /**
   * Days between today and the most recent non-deleted visit, used
   * by the master-strip color indicator (green / yellow / red).
   * `null` when the patient has no recorded visits yet.
   */
  daysSinceLastVisit: number | null;
  /** Total non-deleted visits. Equivalent to `visits.length` today. */
  visitCount: number;
  /**
   * Growth-chart measurement points across the patient's full visit
   * history (oldest first). Includes points outside the 0–24 month
   * WHO band — the frontend filters or routes them to the historical
   * view. Visits with no measurements are omitted.
   */
  growthPoints: ChartGrowthPointDto[];
}
