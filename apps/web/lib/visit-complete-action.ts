// "Përfundo vizitën" / "Anulo statusin" orchestrators.
//
// Both go through the shared calendar status endpoint
// (`PATCH /api/visits/:id/status`). The server emits `visit.status_
// changed` via SSE on success so the receptionist's calendar and the
// doctor's home dashboard refresh in real time.
//
// We always re-fetch the visit after the PATCH so the auto-save store
// re-seeds with the new status (the chart endpoint's full DTO is the
// auth source for the form). The chart-shell refresh keeps the
// history list + master strip in sync.
//
// Extracted from chart-view.tsx so the navigation timing is unit-
// testable without mounting the chart UI tree.

import { ApiError } from './api';
import { useAutoSaveStore } from './use-visit-autosave';
import { calendarClient } from './visits-calendar-client';
import { visitClient, type VisitDto } from './visit-client';

/**
 * Delay (ms) between showing the "Vizita u përfundua." toast and
 * navigating to the doctor's dashboard. Long enough for the toast to
 * actually render and for the eye to register the confirmation; short
 * enough that the doctor isn't kept waiting.
 */
export const COMPLETE_VISIT_NAVIGATE_DELAY_MS = 500;

/** Toast payload shape — kept narrow so the spec can mock it cheaply. */
export type StatusToast = { id: string; message: string } | null;

/** Minimal subset of `next/navigation`'s router needed for navigation. */
export interface PushRouter {
  push(href: string): void;
}

export async function completeVisit(
  visit: VisitDto,
  setActiveVisit: (v: VisitDto | null) => void,
  setStatusToast: (t: StatusToast) => void,
  refresh: () => Promise<void>,
  router: PushRouter,
): Promise<void> {
  // Flush in-flight auto-save first — the doctor's last keystrokes
  // should be on record before the status flips.
  await useAutoSaveStore.getState().save();
  try {
    await calendarClient.changeStatus(visit.id, 'completed');
    const res = await visitClient.getOne(visit.id);
    setActiveVisit(res.visit);
    setStatusToast({
      id: `complete:${visit.id}:${Date.now()}`,
      message: 'Vizita u përfundua.',
    });
    await refresh();
    // Give the toast a beat to render before we leave the chart.
    // The receptionist's calendar updates in parallel via the
    // `visit.status_changed` SSE event, so by the time the doctor
    // lands on /doctor the dashboard's day-log already reflects the
    // completed row. Plain `setTimeout` (not `window.setTimeout`) so
    // the spec can run under the node Vitest environment.
    setTimeout(() => {
      router.push('/doctor');
    }, COMPLETE_VISIT_NAVIGATE_DELAY_MS);
  } catch (err) {
    setStatusToast({
      id: `complete-err:${visit.id}:${Date.now()}`,
      message:
        err instanceof ApiError && err.body.message
          ? err.body.message
          : 'Përfundimi i vizitës dështoi. Provoni përsëri.',
    });
  }
}

export async function revertStatus(
  visit: VisitDto,
  setActiveVisit: (v: VisitDto | null) => void,
  setStatusToast: (t: StatusToast) => void,
  refresh: () => Promise<void>,
): Promise<void> {
  try {
    await calendarClient.changeStatus(visit.id, 'arrived');
    const res = await visitClient.getOne(visit.id);
    setActiveVisit(res.visit);
    setStatusToast({
      id: `revert:${visit.id}:${Date.now()}`,
      message: 'Vizita u rihap. Mund të redaktosh të dhënat.',
    });
    await refresh();
  } catch (err) {
    setStatusToast({
      id: `revert-err:${visit.id}:${Date.now()}`,
      message:
        err instanceof ApiError && err.body.message
          ? err.body.message
          : 'Rihapja e vizitës dështoi. Provoni përsëri.',
    });
  }
}
