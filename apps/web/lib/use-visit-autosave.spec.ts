// Tests for the autosave coordinator's status-transition side effect.
//
// The chart shell relies on the autosave to flip scheduled / arrived
// rows into `in_progress` the moment the doctor types their first
// clinical character. Without this the receptionist's calendar
// wouldn't see the doctor engage, and "Përfundo vizitën" wouldn't
// surface on the form. The transition must fire exactly ONCE per
// visit — subsequent saves on the same row should not retry.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';

import { useAutoSaveStore } from './use-visit-autosave';
import { type VisitDto, type VisitFormValues, visitToFormValues } from './visit-client';

const VISIT_ID = '11111111-1111-1111-1111-111111111111';

function visitFixture(overrides: Partial<VisitDto> = {}): VisitDto {
  return {
    id: VISIT_ID,
    clinicId: 'c',
    patientId: 'p',
    visitDate: '2026-05-16',
    status: 'scheduled',
    complaint: null,
    feedingNotes: null,
    feedingBreast: false,
    feedingFormula: false,
    feedingSolid: false,
    weightG: null,
    heightCm: null,
    headCircumferenceCm: null,
    temperatureC: null,
    paymentCode: null,
    examinations: null,
    ultrasoundNotes: null,
    legacyDiagnosis: null,
    prescription: null,
    labResults: null,
    followupNotes: null,
    otherNotes: null,
    diagnoses: [],
    createdAt: '2026-05-16T08:00:00Z',
    updatedAt: '2026-05-16T08:00:00Z',
    createdBy: 'u',
    updatedBy: 'u',
    wasUpdated: false,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchTrace {
  url: string;
  method: string;
  body: unknown;
}

let fetchMock: MockInstance;
let trace: FetchTrace[];

beforeEach(() => {
  trace = [];
  // The autosave coordinator uses `window.setTimeout` to clear the
  // green saved-flash. Vitest runs this suite under the `node`
  // environment (no jsdom), so we polyfill `window` with the Node
  // timer primitives the store needs.
  vi.stubGlobal('window', {
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  });
  // Reset the singleton store between tests — Zustand stores hold
  // state across describe blocks otherwise.
  useAutoSaveStore.getState().reset();
  fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      trace.push({ url, method, body });
      // Order matters: /status must match BEFORE the bare visit path
      // (which would otherwise swallow it).
      if (url.includes('/status') && method === 'PATCH') {
        return jsonResponse({ entry: { id: VISIT_ID, status: 'in_progress' } });
      }
      if (url.match(/\/api\/visits\/[^/]+$/) && method === 'PATCH') {
        // Mirror the PATCH back as the updated visit. The status
        // column itself doesn't change in the PATCH response — the
        // changeStatus call (above) is what flips it.
        const before = useAutoSaveStore.getState();
        return jsonResponse({
          visit: {
            ...visitFixture({
              status: before.visitStatus ?? 'scheduled',
              complaint: body?.complaint ?? null,
            }),
            updatedAt: '2026-05-16T08:01:00Z',
            wasUpdated: true,
          },
        });
      }
      if (url.match(/\/api\/visits\/[^/]+$/) && method === 'GET') {
        // The refresh-after-status-change pull. Returns the row with
        // the post-transition status.
        return jsonResponse({
          visit: visitFixture({
            status: 'in_progress',
            complaint: 'tussis',
            updatedAt: '2026-05-16T08:01:01Z',
            wasUpdated: true,
          }),
        });
      }
      return jsonResponse({}, 500);
    });
});

afterEach(() => {
  fetchMock.mockRestore();
  useAutoSaveStore.getState().reset();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seed(visit: VisitDto): VisitFormValues {
  useAutoSaveStore.getState().setVisit(visit);
  return visitToFormValues(visit);
}

function dirty(values: VisitFormValues, patch: Partial<VisitFormValues>): void {
  useAutoSaveStore.getState().setValues({ ...values, ...patch });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('autosave status transition', () => {
  it('flips scheduled → in_progress on the first clinical edit, exactly once', async () => {
    const values = seed(visitFixture({ status: 'scheduled' }));
    const onVisitChanged = vi.fn();
    useAutoSaveStore.getState().setOnVisitChanged(onVisitChanged);

    dirty(values, { complaint: 'tussis' });
    await useAutoSaveStore.getState().save();

    // Three calls in order: PATCH /api/visits/:id (clinical fields),
    // PATCH /api/visits/:id/status (transition), GET /api/visits/:id
    // (refresh for the chart-shell). The third tells the store the
    // new status so the next save short-circuits.
    const methods = trace.map((t) => `${t.method} ${t.url.replace(/^.*\/api\//, '/api/')}`);
    expect(methods).toEqual([
      `PATCH /api/visits/${VISIT_ID}`,
      `PATCH /api/visits/${VISIT_ID}/status`,
      `GET /api/visits/${VISIT_ID}`,
    ]);
    const statusCall = trace[1]!;
    expect(statusCall.body).toEqual({ status: 'in_progress' });
    // The chart-shell bridge gets the refreshed VisitDto so the
    // "Përfundo vizitën" CTA can mount without manual refresh.
    expect(onVisitChanged).toHaveBeenCalledTimes(1);
    expect(onVisitChanged.mock.calls[0]?.[0]?.status).toBe('in_progress');
    // The store's tracked status now reflects the post-transition
    // value — guards against re-firing on subsequent saves.
    expect(useAutoSaveStore.getState().visitStatus).toBe('in_progress');

    // A second edit on the SAME visit: PATCH only, no status call.
    trace.length = 0;
    const after = useAutoSaveStore.getState().values!;
    dirty(after, { complaint: 'tussis et febris' });
    await useAutoSaveStore.getState().save();
    const secondMethods = trace.map((t) => `${t.method} ${t.url.replace(/^.*\/api\//, '/api/')}`);
    expect(secondMethods).toEqual([`PATCH /api/visits/${VISIT_ID}`]);
    expect(onVisitChanged).toHaveBeenCalledTimes(1);
  });

  it('also fast-paths arrived → in_progress', async () => {
    const values = seed(visitFixture({ status: 'arrived' }));
    useAutoSaveStore.getState().setOnVisitChanged(vi.fn());

    dirty(values, { complaint: 'tussis' });
    await useAutoSaveStore.getState().save();

    const statusCall = trace.find((t) => t.url.includes('/status'));
    expect(statusCall?.body).toEqual({ status: 'in_progress' });
  });

  it('does NOT fire the transition when the visit is already in_progress', async () => {
    const values = seed(visitFixture({ status: 'in_progress' }));
    useAutoSaveStore.getState().setOnVisitChanged(vi.fn());

    dirty(values, { complaint: 'tussis' });
    await useAutoSaveStore.getState().save();

    expect(trace.some((t) => t.url.includes('/status'))).toBe(false);
  });

  it('does NOT fire the transition for a completed visit being re-edited (defensive)', async () => {
    // After "Anulo statusin" the row is `arrived` (handled above);
    // a `completed` row appearing here would be a bug, but the
    // predicate still guards: we never transition from completed.
    const values = seed(visitFixture({ status: 'completed' }));
    useAutoSaveStore.getState().setOnVisitChanged(vi.fn());

    dirty(values, { complaint: 'tussis' });
    await useAutoSaveStore.getState().save();

    expect(trace.some((t) => t.url.includes('/status'))).toBe(false);
  });

  it('does NOT fire any save when the form is dirtied then un-dirtied (no PATCH, no transition)', async () => {
    const values = seed(visitFixture({ status: 'scheduled' }));
    useAutoSaveStore.getState().setOnVisitChanged(vi.fn());

    dirty(values, { complaint: 'oops' });
    dirty(values, { complaint: '' }); // back to server state
    await useAutoSaveStore.getState().save();

    expect(trace).toHaveLength(0);
  });

  it('swallows status-transition failures — the clinical PATCH still wins (data not lost)', async () => {
    // Override the status endpoint to 500. The PATCH succeeds; the
    // transition fails silently and the autosave still reports saved.
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      trace.push({ url, method, body });
      if (url.includes('/status')) return jsonResponse({ message: 'oops' }, 500);
      if (method === 'PATCH') {
        return jsonResponse({
          visit: visitFixture({
            status: 'scheduled',
            complaint: body?.complaint ?? null,
            updatedAt: '2026-05-16T08:01:00Z',
            wasUpdated: true,
          }),
        });
      }
      return jsonResponse({}, 500);
    });
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const values = seed(visitFixture({ status: 'scheduled' }));
    useAutoSaveStore.getState().setOnVisitChanged(vi.fn());

    dirty(values, { complaint: 'tussis' });
    await useAutoSaveStore.getState().save();

    // The clinical PATCH landed; the failure dialog stays closed
    // (data was saved). Tracked status stays scheduled because the
    // transition didn't complete — a future edit will retry the
    // transition, which is the right recovery posture.
    expect(useAutoSaveStore.getState().failureDialogOpen).toBe(false);
    expect(useAutoSaveStore.getState().visitStatus).toBe('scheduled');
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
