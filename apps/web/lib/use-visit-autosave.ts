'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { create } from 'zustand';

import {
  type UpdateVisitInput,
  type VisitDto,
  type VisitFormValues,
  diffFormValues,
  visitToFormValues,
  visitClient,
} from './visit-client';
import { clearBackup, writeBackup } from './visit-backup';

// ---------------------------------------------------------------------------
// State machine (idle → dirty → saving → saved → idle, with error branch)
// ---------------------------------------------------------------------------
//
// The five canonical states match the prototype (chart.html §autosave):
//
//   idle         — no edits since last save (timestamp shown)
//   dirty        — local edits pending, not yet flushed
//   saving       — request in flight
//   saved-flash  — last save succeeded (300ms transient state for the
//                  green flash; resolves to `idle`)
//   error        — last save failed; failureDialogOpen is true, the
//                  backup is in IndexedDB
//
// Transitions are deterministic — only one save is in flight at a
// time. New edits while saving go into `nextValues` and are flushed
// when the current request finishes.

export type AutoSaveState = 'idle' | 'dirty' | 'saving' | 'saved-flash' | 'error';

export interface AutoSaveStore {
  // Per-visit fields. `null` when no visit is loaded.
  visitId: string | null;
  /** The last-known server-side values. */
  serverValues: VisitFormValues | null;
  /** The user's working copy — what the inputs render. */
  values: VisitFormValues | null;

  state: AutoSaveState;
  /** ISO of the most recent successful save. */
  lastSavedAt: string | null;
  /** Fields that were dirty in the failed save (used by the dialog). */
  unsavedFields: string[];
  failureDialogOpen: boolean;

  // Imperative actions (called from the form + lifecycle hooks).
  setVisit: (visit: VisitDto | null) => void;
  setValues: (values: VisitFormValues) => void;
  /** Programmatic save (debounce timer, blur, beforeunload, Cmd+S). */
  save: () => Promise<void>;
  /** Retry from the save-failure dialog. */
  retry: () => Promise<void>;
  /** Close the failure dialog without retrying. */
  dismissDialog: () => void;
  /** Mark the visit dirty manually (used by the unit tests). */
  markDirty: () => void;
  /** Reset everything (used when switching patients/visits). */
  reset: () => void;
}

interface InternalState {
  inflight: Promise<void> | null;
  pendingValues: VisitFormValues | null;
}
const internal: InternalState = { inflight: null, pendingValues: null };

export const useAutoSaveStore = create<AutoSaveStore>((set, get) => ({
  visitId: null,
  serverValues: null,
  values: null,
  state: 'idle',
  lastSavedAt: null,
  unsavedFields: [],
  failureDialogOpen: false,

  setVisit: (visit) => {
    if (!visit) {
      internal.inflight = null;
      internal.pendingValues = null;
      set({
        visitId: null,
        serverValues: null,
        values: null,
        state: 'idle',
        lastSavedAt: null,
        unsavedFields: [],
        failureDialogOpen: false,
      });
      return;
    }
    const values = visitToFormValues(visit);
    set({
      visitId: visit.id,
      serverValues: values,
      values,
      state: 'idle',
      lastSavedAt: visit.wasUpdated ? visit.updatedAt : null,
      unsavedFields: [],
      failureDialogOpen: false,
    });
  },

  setValues: (values) => {
    const { serverValues, state } = get();
    if (!serverValues) {
      set({ values });
      return;
    }
    const patch = diffFormValues(serverValues, values);
    // No-op writes (toggling and untoggling) keep us in `idle`.
    if (patch == null) {
      set({ values, state: state === 'saving' ? 'saving' : 'idle' });
      return;
    }
    set({
      values,
      state: state === 'saving' ? 'saving' : 'dirty',
    });
  },

  markDirty: () => {
    set({ state: 'dirty' });
  },

  save: async () => {
    await runSave(set, get);
  },

  retry: async () => {
    set({ failureDialogOpen: false });
    await runSave(set, get);
  },

  dismissDialog: () => set({ failureDialogOpen: false }),

  reset: () => {
    internal.inflight = null;
    internal.pendingValues = null;
    set({
      visitId: null,
      serverValues: null,
      values: null,
      state: 'idle',
      lastSavedAt: null,
      unsavedFields: [],
      failureDialogOpen: false,
    });
  },
}));

// ---------------------------------------------------------------------------
// Save coordinator — never lets two PATCHes overlap
// ---------------------------------------------------------------------------

async function runSave(
  set: (partial: Partial<AutoSaveStore>) => void,
  get: () => AutoSaveStore,
): Promise<void> {
  const { visitId, serverValues, values } = get();
  if (!visitId || !serverValues || !values) return;

  // If something is already in flight, fold the latest values into
  // the pending slot and let the inflight resolution pick it up.
  if (internal.inflight) {
    internal.pendingValues = values;
    return internal.inflight;
  }

  const patch = diffFormValues(serverValues, values);
  if (patch == null) {
    if (get().state === 'dirty') set({ state: 'idle' });
    return;
  }

  internal.inflight = (async () => {
    try {
      set({ state: 'saving' });
      const res = await visitClient.update(visitId, patch);
      const next = visitToFormValues(res.visit);
      const after = get().values;
      // Server view is now `next`. Only the bits the user has typed
      // since the request fired stay dirty.
      const stillDirty = after ? diffFormValues(next, after) : null;
      set({
        serverValues: next,
        // Don't clobber what the user typed mid-flight.
        values: after ?? next,
        state: stillDirty ? 'dirty' : 'saved-flash',
        lastSavedAt: res.visit.updatedAt,
        unsavedFields: [],
        failureDialogOpen: false,
      });
      // Clear any IndexedDB backup — we're current with the server.
      void clearBackup(visitId);
      if (!stillDirty) {
        // Drop the flash state after 1s to the idle "saved at …" line.
        window.setTimeout(() => {
          if (get().state === 'saved-flash') set({ state: 'idle' });
        }, 1_000);
      }
    } catch (err) {
      const dirtyFields = listDirtyFields(serverValues, values);
      set({
        state: 'error',
        unsavedFields: dirtyFields,
        failureDialogOpen: true,
      });
      // Best-effort backup so refreshing the page recovers the work.
      void writeBackup(visitId, values);
      // Surface to the console for ops; no PHI in the error message,
      // only the field names.
      console.warn('visit auto-save failed', {
        visitId,
        fields: dirtyFields,
        message: err instanceof Error ? err.message : 'unknown',
      });
    } finally {
      internal.inflight = null;
      const pending = internal.pendingValues;
      internal.pendingValues = null;
      if (pending) {
        // Newer edits arrived during the request — flush them.
        await runSave(set, get);
      }
    }
  })();

  return internal.inflight;
}

function listDirtyFields(
  before: VisitFormValues,
  after: VisitFormValues,
): string[] {
  const fields: string[] = [];
  const keys: (keyof VisitFormValues)[] = [
    'visitDate',
    'complaint',
    'feedingNotes',
    'feedingBreast',
    'feedingFormula',
    'feedingSolid',
    'weightKg',
    'heightCm',
    'headCircumferenceCm',
    'temperatureC',
    'paymentCode',
    'examinations',
    'ultrasoundNotes',
    'legacyDiagnosis',
    'prescription',
    'labResults',
    'followupNotes',
    'otherNotes',
  ];
  for (const k of keys) {
    if (before[k] !== after[k]) fields.push(k);
  }
  return fields;
}

// ---------------------------------------------------------------------------
// React hook: ties debounce, blur, idle, beforeunload, navigation
// ---------------------------------------------------------------------------
//
// The form mounts this hook once per visit. It wires:
//
//   * 1.5s debounce after the last setValues call
//   * 30s idle timer (resets on each setValues)
//   * `beforeunload` keepalive PATCH
//   * `visibilitychange` (tab-hidden) flush
//
// Field blur and navigation are triggered by the form directly via
// `flush()` — the hook returns that imperative handle.

const DEBOUNCE_MS = 1_500;
const IDLE_MS = 30_000;

export interface AutoSaveHandle {
  flush: () => Promise<void>;
  isDirty: boolean;
  state: AutoSaveState;
}

export function useVisitAutoSave(visitId: string | null): AutoSaveHandle {
  const save = useAutoSaveStore((s) => s.save);
  const state = useAutoSaveStore((s) => s.state);
  const values = useAutoSaveStore((s) => s.values);
  const serverValues = useAutoSaveStore((s) => s.serverValues);

  const isDirty = useMemo(() => {
    if (!serverValues || !values) return false;
    return diffFormValues(serverValues, values) != null;
  }, [serverValues, values]);

  const debounceRef = useRef<number | null>(null);
  const idleRef = useRef<number | null>(null);

  // Debounce + idle timers re-arm whenever `values` change.
  useEffect(() => {
    if (!visitId) return;
    if (!isDirty) {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (idleRef.current) window.clearTimeout(idleRef.current);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void save();
    }, DEBOUNCE_MS);

    if (idleRef.current) window.clearTimeout(idleRef.current);
    idleRef.current = window.setTimeout(() => {
      void save();
    }, IDLE_MS);

    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      if (idleRef.current) window.clearTimeout(idleRef.current);
    };
  }, [values, visitId, isDirty, save]);

  // beforeunload — best-effort synchronous PATCH via fetch keepalive.
  useEffect(() => {
    if (!visitId) return;
    function onBeforeUnload(): void {
      const state = useAutoSaveStore.getState();
      if (!state.visitId || !state.values || !state.serverValues) return;
      const patch = diffFormValues(state.serverValues, state.values);
      if (!patch) return;
      visitClient.updateBeforeUnload(state.visitId, patch);
    }
    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') onBeforeUnload();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [visitId]);

  // Document title — `*` prefix when dirty so a typing-and-tab-switch
  // user can see the unsaved indicator in the tab strip.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.title;
    if (isDirty && !original.startsWith('* ')) {
      document.title = `* ${original}`;
    } else if (!isDirty && original.startsWith('* ')) {
      document.title = original.slice(2);
    }
    return () => {
      if (typeof document === 'undefined') return;
      if (document.title.startsWith('* ')) {
        document.title = document.title.slice(2);
      }
    };
  }, [isDirty]);

  const flush = useCallback(async () => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    await save();
  }, [save]);

  return { flush, isDirty, state };
}

// ---------------------------------------------------------------------------
// Exports for tests
// ---------------------------------------------------------------------------

export const __internal = internal;
export type { UpdateVisitInput };
