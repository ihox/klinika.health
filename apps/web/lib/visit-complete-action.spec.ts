// Unit-tests for the "Përfundo vizitën" orchestrator.
//
// The chart view wires this to the primary completion CTA. After the
// PATCH succeeds we show a confirmation toast, wait 500ms for the eye
// to register it, then navigate to the doctor's dashboard (/doctor).
// The 500ms beat is the contract the spec pins — too short and the
// toast vanishes before the doctor sees it.

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  COMPLETE_VISIT_NAVIGATE_DELAY_MS,
  completeVisit,
  type PushRouter,
  type StatusToast,
} from './visit-complete-action';
import type { VisitDto } from './visit-client';

// The autosave store is mocked at module level — `completeVisit` calls
// `useAutoSaveStore.getState().save()` to flush in-flight edits, and we
// don't want to spin up the real Zustand store for an orchestration
// test. The mock just records that save() was called.
const saveMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./use-visit-autosave', () => ({
  useAutoSaveStore: {
    getState: () => ({ save: saveMock }),
  },
}));

const VISIT_ID = '11111111-1111-1111-1111-111111111111';

function visitFixture(): VisitDto {
  // Minimal shape — completeVisit only reads `.id` and passes the
  // result of `visitClient.getOne` onward. Anything else is supplied
  // by the (mocked) re-fetch.
  return { id: VISIT_ID } as VisitDto;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: MockInstance;

beforeEach(() => {
  vi.useFakeTimers();
  saveMock.mockClear();
  // Two endpoints get hit in sequence:
  //   PATCH /api/visits/:id/status   → { entry: ... }
  //   GET   /api/visits/:id          → { visit: ... }
  // The router timing is what matters, so both responses are minimal.
  fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/status')) return jsonResponse({ entry: {} });
      return jsonResponse({ visit: visitFixture() });
    });
});

afterEach(() => {
  fetchMock.mockRestore();
  vi.useRealTimers();
});

describe('completeVisit', () => {
  it('shows the confirmation toast and navigates to /doctor after the delay', async () => {
    const setActiveVisit = vi.fn();
    const toastCalls: StatusToast[] = [];
    const setStatusToast = (t: StatusToast) => toastCalls.push(t);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const router: PushRouter = { push: vi.fn() };

    await completeVisit(
      visitFixture(),
      setActiveVisit,
      setStatusToast,
      refresh,
      router,
    );

    // Auto-save flushed first, then the two-call sequence ran and the
    // toast went up. Router.push is queued for `COMPLETE_VISIT_NAVIGATE_
    // DELAY_MS` later — at this point it must NOT have fired yet.
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.message).toBe('Vizita u përfundua.');
    expect(setActiveVisit).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();

    // Advance just under the delay — still no navigation.
    vi.advanceTimersByTime(COMPLETE_VISIT_NAVIGATE_DELAY_MS - 1);
    expect(router.push).not.toHaveBeenCalled();

    // Cross the threshold — the doctor lands on the dashboard.
    vi.advanceTimersByTime(1);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/doctor');
  });

  it('shows an Albanian error toast and does NOT navigate when the PATCH fails', async () => {
    // Override only the status-change endpoint to fail; the re-fetch
    // never runs because the catch trips first.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/status')) {
        return jsonResponse({ message: 'Lock-out, provo më vonë.' }, 423);
      }
      return jsonResponse({ visit: visitFixture() });
    });

    const setActiveVisit = vi.fn();
    const toastCalls: StatusToast[] = [];
    const setStatusToast = (t: StatusToast) => toastCalls.push(t);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const router: PushRouter = { push: vi.fn() };

    await completeVisit(
      visitFixture(),
      setActiveVisit,
      setStatusToast,
      refresh,
      router,
    );

    // Error path: toast holds the server's Albanian message, the
    // local state never advances, and we DO NOT navigate away.
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0]?.message).toBe('Lock-out, provo më vonë.');
    expect(setActiveVisit).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(COMPLETE_VISIT_NAVIGATE_DELAY_MS * 2);
    expect(router.push).not.toHaveBeenCalled();
  });
});
