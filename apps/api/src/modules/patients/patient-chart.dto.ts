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
}
