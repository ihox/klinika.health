'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { ClinicTopNav } from '@/components/clinic-top-nav';
import { Skeleton } from '@/components/skeleton';
import { Button } from '@/components/ui/button';
import { UndoToast } from '@/components/undo-toast';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';
import {
  addLocalDays,
  dayLabelLong,
  formatLongAlbanianDate,
  formatRangeAlbanian,
  mondayOfWeekIso,
  todayIsoLocal,
  toLocalParts,
  weekdayOf,
} from '@/lib/appointment-client';
import { clinicClient, type ClinicSettings, type HoursConfig } from '@/lib/clinic-client';
import type { PatientPublicDto } from '@/lib/patient-client';
import {
  type CalendarEntry,
  type CalendarStatsResponse,
  type VisitStatus,
  calendarClient,
  isReceptionistOnlyRole,
  isVisitLockedForReceptionist,
} from '@/lib/visits-calendar-client';

import { AppointmentActions, type EntryAction } from './appointment-actions';
import { BookingDialog, type BookingDialogResult } from './booking-dialog';
import { CalendarGrid, type DayColumn } from './calendar-grid';
import { GlobalPatientSearch } from './global-patient-search';
import { QuickAddPatientModal } from './pacientet/quick-add-patient-modal';
import { PatientPicker } from './patient-picker';
import {
  type StatusFilter,
  StatusFilters,
  countByStatusFilter,
  entryMatchesStatusFilter,
} from './status-filters';

// The receptionist calendar shows a fixed Monday-Saturday week. Sunday is
// hidden — clinics are closed by default, and the design reference reserves
// the 6-column grid for Mon..Sat.
const VISIBLE_WEEKDAYS: Array<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat'> = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
];
const STATS_POLL_MS = 30_000;

interface UndoState {
  /** ID of the appointment that was just affected (for restore + delete-undo). */
  id: string;
  patientName: string;
  /** Server-stamped expiry. */
  restorableUntil: string;
  /** Main toast line, e.g. "Termini u fshi." */
  message: string;
  /** Optional dim sub-line, e.g. "Eriona Krasniqi · 14:30". */
  secondary?: string;
  /**
   * What "Anulo" should do:
   *   `restore-deleted` — call POST /restore (post-delete undo)
   *   `soft-delete`     — call DELETE /:id (post-booking undo)
   */
  intent: 'restore-deleted' | 'soft-delete';
}

interface BookingState {
  mode: 'create' | 'edit';
  appointmentId?: string;
  patient: PatientPublicDto;
  initialDate: string;
  initialTime: string;
  initialDurationMinutes?: number;
  prefilledFromSlot: boolean;
}

interface PickerState {
  /**
   * Context that opened the picker.
   *   - 'slot'   : tap on an empty time slot → opens booking dialog after pick
   *   - 'global' : top-bar global search → opens booking dialog after pick (date=today, time=blank)
   *   - 'walkin' : "+ Pacient pa termin" → immediately POSTs a walk-in, no dialog
   */
  source: 'slot' | 'global' | 'walkin';
  date: string;
  time: string;
  anchor: { x: number; y: number };
  /**
   * For walk-in flows: the scheduled visit the receptionist explicitly
   * paired this walk-in to (per-row "+ Pa termin" hover affordance).
   * When undefined on a walk-in flow (toolbar `[+ Pa termin]` click)
   * the client picks the slot closest to now — see STEP 5.
   */
  pairedVisitId?: string;
}

interface QuickAddState {
  seed: string;
  /**
   * Where to route the new patient on success.
   *   - kind='booking' : open the booking dialog with the new patient pre-selected
   *   - kind='walkin'  : immediately POST /api/visits/walkin with the new patient
   */
  returnTo:
    | { kind: 'booking'; date: string; time: string; prefilledFromSlot: boolean }
    | { kind: 'walkin'; pairedVisitId?: string };
}

export function CalendarView(): ReactElement {
  // The receptionist edit-lock (daily-report integrity) is per-visit-
  // per-role. `me` carries the session's roles array; we mirror the
  // backend's `isReceptionistOnly` so multi-role users
  // (receptionist+doctor, receptionist+clinic_admin) keep their full
  // edit capabilities, and so doctor-only sessions visiting this page
  // (rare — admin debug?) aren't restricted either. The server is
  // authoritative; this client predicate just disables affordances
  // proactively so receptionists don't click into a 403.
  const { me } = useMe();
  const isReceptionistOnly = isReceptionistOnlyRole(me?.roles ?? null);

  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [stats, setStats] = useState<CalendarStatsResponse | null>(null);
  const [unmarked, setUnmarked] = useState<CalendarEntry[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const [picker, setPicker] = useState<PickerState | null>(null);
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [actionsFor, setActionsFor] = useState<{
    entry: CalendarEntry;
    anchor: { x: number; y: number };
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const todayIso = useMemo(() => todayIsoLocal(now), [now]);

  // Receptionist edit-lock predicate. Recomputed when the day rolls
  // over or the role flag flips. Doctor / clinic_admin sessions get a
  // constant `() => false` so locked-state never gates their UI.
  const isLockedForReceptionist = useCallback(
    (entry: CalendarEntry): boolean => {
      if (!isReceptionistOnly) return false;
      return isVisitLockedForReceptionist(entry, todayIso);
    },
    [isReceptionistOnly, todayIso],
  );

  // ----- Displayed week: Monday-anchored, persisted to the URL.
  //
  // `?from=YYYY-MM-DD` carries the week's Monday anchor; the current
  // week is encoded by the param being absent (cleaner URL when the
  // receptionist hasn't navigated away from today). Navigation updates
  // the URL via `router.replace` so back/forward + reload preserve the
  // viewed week, and pasted links open the same view. Without a (valid)
  // `from`, we render the Monday of today's local week.
  const router = useRouter();
  const pathname = usePathname() ?? '/receptionist';
  const searchParams = useSearchParams();
  const fromParam = searchParams.get('from');
  const todayWeekStart = useMemo(() => mondayOfWeekIso(todayIso), [todayIso]);
  const weekStart = useMemo(() => {
    if (fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam)) {
      return mondayOfWeekIso(fromParam);
    }
    return todayWeekStart;
  }, [fromParam, todayWeekStart]);
  const navigateWeek = useCallback(
    (next: string) => {
      const sp = new URLSearchParams(searchParams.toString());
      if (next === todayWeekStart) {
        sp.delete('from');
      } else {
        sp.set('from', next);
      }
      const qs = sp.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, todayWeekStart],
  );
  const goPrevWeek = useCallback(
    () => navigateWeek(addLocalDays(weekStart, -7)),
    [navigateWeek, weekStart],
  );
  const goNextWeek = useCallback(
    () => navigateWeek(addLocalDays(weekStart, 7)),
    [navigateWeek, weekStart],
  );
  const goThisWeek = useCallback(
    () => navigateWeek(todayWeekStart),
    [navigateWeek, todayWeekStart],
  );
  const isCurrentWeek = weekStart === todayWeekStart;

  // ----- Columns: fixed Mon..Sat of the displayed week. Sunday is hidden
  // (clinics are closed; the grid is 6 columns). Each column carries the
  // clinic's open/close state for that weekday — closed days render the
  // "Mbyllur" hatched overlay inside the grid.
  const columns: DayColumn[] = useMemo(() => {
    if (!settings) return [];
    const hours = settings.hours;
    return VISIBLE_WEEKDAYS.map((dow, idx) => {
      const date = addLocalDays(weekStart, idx);
      const day = hours.days[dow];
      return {
        date,
        weekday: dow,
        open: day.open,
        startTime: day.open ? day.start : '10:00',
        endTime: day.open ? day.end : '18:00',
      };
    });
  }, [settings, weekStart]);

  const rangeFrom = columns[0]?.date ?? todayIso;
  const rangeTo = columns[columns.length - 1]?.date ?? todayIso;
  const rangeLabel = useMemo(
    () =>
      columns.length > 0 ? formatRangeAlbanian(rangeFrom, rangeTo) : 'Pa data',
    [columns.length, rangeFrom, rangeTo],
  );

  const refreshEntries = useCallback(async () => {
    if (columns.length === 0) return;
    try {
      const res = await calendarClient.list(rangeFrom, rangeTo);
      setEntries(res.entries);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?reason=session-expired';
        return;
      }
      setError('Nuk u ngarkuan terminet.');
    }
  }, [columns.length, rangeFrom, rangeTo]);

  const refreshStats = useCallback(async () => {
    try {
      const res = await calendarClient.stats(todayIso);
      setStats(res);
    } catch {
      // Stats are non-fatal — keep the previous snapshot.
    }
  }, [todayIso]);

  const refreshUnmarked = useCallback(async () => {
    try {
      const res = await calendarClient.unmarkedPast();
      setUnmarked(res.entries);
    } catch {
      setUnmarked([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await clinicClient.getSettings();
        if (!cancelled) setSettings(s);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = '/login?reason=session-expired';
          return;
        }
        if (!cancelled) setError('Nuk u ngarkuan cilësimet e klinikës.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshEntries();
    void refreshStats();
    void refreshUnmarked();
  }, [refreshEntries, refreshStats, refreshUnmarked]);

  // ----- Now line: tick every minute, refresh stats every 30s
  useEffect(() => {
    const tick = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(tick);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => {
      void refreshStats();
    }, STATS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshStats]);

  // ----- SSE: real-time updates from the calendar event bus. The server
  // emits `visit.*` events (created / updated / status_changed / deleted
  // / restored) — we don't filter by type since every event invalidates
  // the calendar feed.
  useEffect(() => {
    const url = calendarClient.streamUrl();
    const source = new EventSource(url, { withCredentials: true });
    const onAny = (): void => {
      void refreshEntries();
      void refreshStats();
    };
    source.addEventListener('visit.created', onAny);
    source.addEventListener('visit.updated', onAny);
    source.addEventListener('visit.status_changed', onAny);
    source.addEventListener('visit.deleted', onAny);
    source.addEventListener('visit.restored', onAny);
    source.onerror = () => {
      // Browser auto-reconnects; fall back to polling-only.
    };
    return () => source.close();
  }, [refreshEntries, refreshStats]);

  // ----- Tab/window focus: invalidate caches.
  useEffect(() => {
    function onVis(): void {
      if (document.visibilityState === 'visible') {
        void refreshEntries();
        void refreshStats();
        void refreshUnmarked();
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshEntries, refreshStats, refreshUnmarked]);

  // Last mousedown coords — used to anchor the slot-first popover next
  // to wherever the receptionist tapped. Refs avoid a re-render per
  // mouse-move.
  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    function onMove(e: MouseEvent): void {
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener('mousedown', onMove);
    return () => window.removeEventListener('mousedown', onMove);
  }, []);

  // ----- Slot click → patient picker (Path 1)
  const onSlotClick = useCallback(
    (params: { date: string; time: string }) => {
      setActionsFor(null);
      const anchor = lastMouseRef.current ?? { x: window.innerWidth / 2, y: 120 };
      setPicker({ source: 'slot', ...params, anchor });
    },
    [],
  );

  // ----- Card / chip click → action menu
  const onEntryClick = useCallback(
    (entry: CalendarEntry, anchor: { x: number; y: number }) => {
      setPicker(null);
      setActionsFor({ entry, anchor });
    },
    [],
  );

  // ----- Status / delete actions
  const applyStatus = useCallback(
    async (entry: CalendarEntry, next: VisitStatus) => {
      try {
        await calendarClient.changeStatus(entry.id, next);
        await refreshEntries();
        await refreshStats();
        await refreshUnmarked();
        const labels: Partial<Record<VisitStatus, string>> = {
          arrived: 'i shënuar si paraqitur',
          in_progress: 'i shënuar si në vizitë',
          completed: 'i shënuar si kryer',
          no_show: 'i shënuar si mungesë',
        };
        setToast(`Termini ${labels[next] ?? 'u përditësua'}.`);
      } catch {
        setToast('Veprimi dështoi.');
      }
    },
    [refreshEntries, refreshStats, refreshUnmarked],
  );

  const onDelete = useCallback(
    async (entry: CalendarEntry) => {
      try {
        const res = await calendarClient.softDelete(entry.id);
        await refreshEntries();
        await refreshStats();
        const timeLabel = entry.scheduledFor
          ? toLocalParts(new Date(entry.scheduledFor)).time
          : entry.arrivedAt
            ? `↻ ${toLocalParts(new Date(entry.arrivedAt)).time}`
            : '';
        setUndo({
          id: entry.id,
          patientName: `${entry.patient.firstName} ${entry.patient.lastName}`,
          restorableUntil: res.restorableUntil,
          message: entry.isWalkIn ? 'Walk-in u fshi.' : 'Termini u fshi.',
          secondary: `${entry.patient.firstName} ${entry.patient.lastName}${timeLabel ? ` · ${timeLabel}` : ''}`,
          intent: 'restore-deleted',
        });
      } catch (err) {
        // Surface the server's specific Albanian reason when it ships
        // one (the clinical-data guard returns
        // "Vizita ka të dhëna klinike. Kërkoni mjekut ta fshijë." with
        // reason='has_clinical_data'); fall back to a generic message
        // for opaque failures.
        setToast(err instanceof ApiError ? err.message : 'Fshirja dështoi.');
      }
    },
    [refreshEntries, refreshStats],
  );

  // ----- Drag-and-drop reschedule (Fix #2). The grid hands us the
  // snapped (date, time); we PATCH /api/visits/:id/scheduling, refresh
  // the calendar, and announce success/failure via aria-live. Server
  // re-validates (5-min boundary, conflict) — UI prevention is best
  // effort, server is authoritative.
  const ariaLiveRef = useRef<HTMLDivElement | null>(null);
  const announce = useCallback((msg: string) => {
    if (ariaLiveRef.current) ariaLiveRef.current.textContent = msg;
  }, []);
  const onDragReschedule = useCallback(
    async (
      entry: CalendarEntry,
      next: { date: string; time: string },
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      try {
        await calendarClient.reschedule(entry.id, {
          date: next.date,
          time: next.time,
        });
        await refreshEntries();
        await refreshStats();
        const dayLabel = dayLabelLong(weekdayOf(next.date));
        const msg = `Termini u zhvendos në ${dayLabel.toLowerCase()}, ora ${next.time}.`;
        setToast(msg);
        announce(msg);
        return { ok: true };
      } catch (err) {
        const fallback = 'Nuk u zhvendos. Provo përsëri.';
        let message = fallback;
        if (err instanceof ApiError) {
          if (err.body.reason === 'conflict') {
            message = 'Ky orar mbivendoset me një termin tjetër.';
          } else if (err.body.reason === 'after_close') {
            message = 'Termini kalon orarin e mbylljes.';
          } else if (err.body.reason === 'before_open') {
            message = 'Ora është para hapjes së klinikës.';
          } else if (err.body.reason === 'closed_day') {
            message = 'Klinika është e mbyllur këtë ditë.';
          }
        }
        setToast(message);
        announce(message);
        // Trigger a refresh so the card snaps back to the original
        // position (the server still has the old scheduled_for).
        void refreshEntries();
        return { ok: false, message };
      }
      // We don't capture `entry` post-call because the server response
      // is forwarded via setEntries on the next list refresh. The
      // grid will reposition the card to its new top once that lands.
    },
    [announce, refreshEntries, refreshStats],
  );

  // ----- Edit existing appointment (open booking dialog in edit mode)
  // Walk-ins can't be rescheduled — they have no slot. The action menu
  // hides the option, so this only fires on scheduled entries.
  const onReschedule = useCallback((entry: CalendarEntry) => {
    if (entry.scheduledFor == null) return;
    const local = toLocalParts(new Date(entry.scheduledFor));
    setBooking({
      mode: 'edit',
      appointmentId: entry.id,
      patient: {
        id: entry.patientId,
        firstName: entry.patient.firstName,
        lastName: entry.patient.lastName,
        dateOfBirth: entry.patient.dateOfBirth,
        // Calendar entries don't carry placeOfBirth — the booking
        // dialog doesn't render it. Pass null to satisfy the shared
        // PatientPublicDto contract.
        placeOfBirth: null,
        lastVisitAt: entry.lastVisitAt,
      },
      initialDate: local.date,
      initialTime: local.time,
      initialDurationMinutes: entry.durationMinutes ?? undefined,
      prefilledFromSlot: false,
    });
  }, []);

  // ----- Undo handling for both flows (delete-undo + post-booking undo)
  const runUndo = useCallback(async () => {
    if (!undo) return;
    try {
      if (undo.intent === 'restore-deleted') {
        await calendarClient.restore(undo.id);
        setToast(`Termini i ${undo.patientName} u rikthye.`);
      } else {
        await calendarClient.softDelete(undo.id);
        setToast('Termini u anulua.');
      }
      await refreshEntries();
      await refreshStats();
    } catch (err) {
      // Same as `onDelete`: pass through the server's Albanian reason
      // when present so the receptionist understands why the action
      // was refused (most often: clinical data on the row).
      setToast(err instanceof ApiError ? err.message : 'Anulimi dështoi.');
    } finally {
      setUndo(null);
    }
  }, [refreshEntries, refreshStats, undo]);

  // Auto-dismiss the undo toast after 30s.
  useEffect(() => {
    if (!undo) return undefined;
    const handle = window.setTimeout(() => setUndo(null), 30_000);
    return () => window.clearTimeout(handle);
  }, [undo]);

  // Auto-dismiss the inline toast after 4s.
  useEffect(() => {
    if (!toast) return undefined;
    const handle = window.setTimeout(() => setToast(null), 4_000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  // ----- Walk-in entry: POST /api/visits/walkin and refresh. No dialog,
  // no follow-up question — the receptionist's intent is "this patient
  // is here NOW, the doctor will pull them in." Toast confirms.
  //
  // `pairedVisitId` carries the explicit pairing the receptionist
  // selected via the per-row hover affordance (STEP 3) or the closest
  // match computed for the toolbar `[+ Pa termin]` click (STEP 5).
  // Server validates it against the operational rules in STEP 4.
  const addWalkin = useCallback(
    async (p: PatientPublicDto, pairedVisitId?: string) => {
      try {
        await calendarClient.createWalkin({
          patientId: p.id,
          ...(pairedVisitId ? { pairedWithVisitId: pairedVisitId } : {}),
        });
        await refreshEntries();
        await refreshStats();
        setToast('Pacienti u shtua. Shfaqet menjëherë në kalendar.');
      } catch {
        setToast('Walk-in dështoi.');
      }
    },
    [refreshEntries, refreshStats],
  );

  // ----- Patient picker → booking flow OR walk-in flow
  const onPatientPicked = useCallback(
    (p: PatientPublicDto) => {
      if (!picker) return;
      const source = picker.source;
      const pairedVisitId = picker.pairedVisitId;
      setPicker(null);
      if (source === 'walkin') {
        void addWalkin(p, pairedVisitId);
        return;
      }
      setBooking({
        mode: 'create',
        patient: p,
        initialDate: picker.date,
        initialTime: picker.time,
        // Slot-first carries time + date from the tap. Patient-first
        // carries today's date but leaves time blank.
        prefilledFromSlot: source === 'slot',
      });
    },
    [addWalkin, picker],
  );

  const onAddNewFromPicker = useCallback(
    (query: string) => {
      if (!picker) return;
      const source = picker.source;
      const pairedVisitId = picker.pairedVisitId;
      setPicker(null);
      if (source === 'walkin') {
        setQuickAdd({
          seed: query,
          returnTo: { kind: 'walkin', ...(pairedVisitId ? { pairedVisitId } : {}) },
        });
        return;
      }
      setQuickAdd({
        seed: query,
        returnTo: {
          kind: 'booking',
          date: picker.date,
          time: picker.time,
          prefilledFromSlot: source === 'slot',
        },
      });
    },
    [picker],
  );

  const onQuickAdded = useCallback(
    (p: PatientPublicDto) => {
      if (!quickAdd) {
        setQuickAdd(null);
        return;
      }
      const returnTo = quickAdd.returnTo;
      setQuickAdd(null);
      if (returnTo.kind === 'walkin') {
        void addWalkin(p, returnTo.pairedVisitId);
        return;
      }
      setBooking({
        mode: 'create',
        patient: p,
        initialDate: returnTo.date,
        initialTime: returnTo.time,
        prefilledFromSlot: returnTo.prefilledFromSlot,
      });
    },
    [addWalkin, quickAdd],
  );

  // ----- Status filter pills (above the grid). Counts are derived
  // from the week's `entries` so the badge tracks the visible range.
  // `visibleEntries` is what feeds the grid — when "Të gjitha" is
  // active it's a no-op pass-through.
  const statusCounts = useMemo(() => countByStatusFilter(entries), [entries]);
  const visibleEntries = useMemo(
    () =>
      statusFilter === 'all'
        ? entries
        : entries.filter((e) => entryMatchesStatusFilter(e, statusFilter)),
    [entries, statusFilter],
  );

  // ----- Open the walk-in picker paired to a specific scheduled visit.
  // The per-row "+ Pa termin" hover affordance routes here: receptionist
  // hovers an appt row → ghost in right lane → click → picker opens →
  // pick patient → POST /api/visits/walkin with `pairedWithVisitId`
  // = the appt's id (server validates per STEP 4).
  const openWalkinPickerForVisit = useCallback(
    (pairedVisit: CalendarEntry, anchor: { x: number; y: number }) => {
      setActionsFor(null);
      const dateForPicker = pairedVisit.scheduledFor
        ? toLocalParts(new Date(pairedVisit.scheduledFor)).date
        : todayIso;
      setPicker({
        source: 'walkin',
        date: dateForPicker,
        time: '',
        anchor,
        pairedVisitId: pairedVisit.id,
      });
    },
    [todayIso],
  );

  // ----- Path 2: global search opens a picker without a slot anchor.
  const openGlobalPickerForPatient = useCallback(
    (p: PatientPublicDto) => {
      setBooking({
        mode: 'create',
        patient: p,
        initialDate: todayIso,
        initialTime: '',
        prefilledFromSlot: false,
      });
    },
    [todayIso],
  );

  const openGlobalQuickAdd = useCallback(
    (seed: string) => {
      setQuickAdd({
        seed,
        returnTo: {
          kind: 'booking',
          date: todayIso,
          time: '',
          prefilledFromSlot: false,
        },
      });
    },
    [todayIso],
  );

  // ----- Booking submitted (success path for both paths and edit mode)
  const onBooked = useCallback(
    (result: BookingDialogResult) => {
      const apt = result.entry;
      const isEdit = booking?.mode === 'edit';
      setBooking(null);
      void refreshEntries();
      void refreshStats();
      void refreshUnmarked();
      // Post-booking undo (only on create). Edit reschedules don't get
      // a 30s undo — the receptionist can just reschedule again.
      if (!isEdit) {
        setUndo({
          id: apt.id,
          patientName: `${apt.patient.firstName} ${apt.patient.lastName}`,
          restorableUntil: new Date(Date.now() + 30_000).toISOString(),
          message: result.toast,
          intent: 'soft-delete',
        });
      } else {
        setToast(result.toast);
      }
    },
    [booking?.mode, refreshEntries, refreshStats, refreshUnmarked],
  );

  const promptCount = unmarked.length;

  if (error && !settings) {
    return (
      <main className="min-h-screen bg-stone-50 grid place-items-center px-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900 max-w-md text-center">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 pb-16">
      {/* Polite aria-live region for drag-and-drop reschedule
          announcements (Fix #2) — keyboard users + screen readers
          hear the outcome of a Shift+Arrow move or a successful drop. */}
      <div
        ref={ariaLiveRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />
      {/* Top bar — role-filtered (ADR-004). The global patient search
          moved inside the calendar card per receptionist.html so the
          top nav stays focused on navigation + identity. */}
      <CalendarTopNav />

      <div className="mx-auto max-w-page px-page-x pt-6">
        {/* Greeting strip. The toolbar's "Pacient pa termin" button was
            retired — the per-row hover affordance inside the grid is
            the canonical entry point for paired walk-ins, and the
            filter-pill counts above the grid replace the redundant
            top-right summary chip. */}
        <div className="mb-5">
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-ink-strong">
            Mirëdita.
          </h1>
          <p className="mt-1 text-[14px] text-ink-muted">
            {formatLongAlbanianDate(todayIso)}
            {settings ? ` · ${settings.general.shortName}` : ''}
          </p>
        </div>

        {/* Stats */}
        <StatsRow stats={stats} now={now} />

        {/* End-of-day prompt. Receptionist-only sessions see the banner
            for visibility but not the "Shëno status" dropdown — the
            edit-lock blocks yesterday's transitions at the server, so
            we hide the affordance rather than letting clicks 403. */}
        {promptCount > 0 ? (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
            role="status"
            aria-live="polite"
          >
            <span>
              <strong className="font-semibold">{promptCount}</strong>{' '}
              {promptCount === 1
                ? 'termin i djeshëm është pa status.'
                : 'termine të djeshme janë pa status.'}{' '}
              {isReceptionistOnly
                ? 'Mjeku duhet të shënojë statusin.'
                : 'Shëno tani?'}
            </span>
            {!isReceptionistOnly ? (
              <UnmarkedDropdown
                items={unmarked}
                onMark={(a, status) => applyStatus(a, status)}
              />
            ) : null}
          </div>
        ) : null}

        {/* Calendar card */}
        {/* overflow-visible so an inline-expanded .appt-card on hover
            can spill past its column / the section's rounded edge.
            Mirrors design-reference/prototype/receptionist.html `.cal-card`. */}
        <section className="mt-5 overflow-visible rounded-lg border border-line bg-surface-elevated shadow-xs">
          {/* Calendar toolbar — date nav on the left, patient search on
              the far right per design-reference/prototype/receptionist.html.
              Search lives inside the toolbar (not in its own row) so the
              calendar grid sits directly under the date nav and we
              reclaim ~52px of vertical space; receptionists scan the
              calendar far more often than they reach for the search. */}
          <div className="flex items-center justify-between gap-4 border-b border-line bg-surface-elevated px-5 py-3.5">
            <div className="flex items-center gap-3">
              <WeekNavButton dir="prev" onClick={goPrevWeek} />
              <div className="font-display text-[17px] font-semibold tracking-[-0.015em] tabular-nums">
                {rangeLabel}
              </div>
              <WeekNavButton dir="next" onClick={goNextWeek} />
              <Button
                variant="ghost"
                size="sm"
                onClick={goThisWeek}
                disabled={isCurrentWeek}
                className="ml-2"
                aria-label="Java aktuale"
              >
                Sot
              </Button>
            </div>
            <GlobalPatientSearch
              onPick={openGlobalPickerForPatient}
              onAddNew={openGlobalQuickAdd}
            />
          </div>

          {/* Status filter pills — narrows the grid view to one bucket.
              Counts mirror the loaded week's entries. */}
          <StatusFilters
            active={statusFilter}
            counts={statusCounts}
            onChange={setStatusFilter}
          />

          {settings && columns.length > 0 ? (
            <CalendarGrid
              todayIso={todayIso}
              now={now}
              hours={settings.hours}
              columns={columns}
              entries={visibleEntries}
              onSlotClick={onSlotClick}
              onEntryClick={onEntryClick}
              // Right-click / tap-and-hold opens the same status menu
              // as a left-click; users on tablets get the same menu via
              // the long-press gesture they expect.
              onEntryContextMenu={onEntryClick}
              onWalkinForVisit={openWalkinPickerForVisit}
              onReschedule={onDragReschedule}
              isLocked={isLockedForReceptionist}
            />
          ) : (
            <CalendarSkeleton />
          )}
        </section>
      </div>

      {/* Picker popover — opens for slot-tap, walk-in button, or
          global-search add-new. */}
      {picker ? (
        <PatientPicker
          anchor={picker.anchor}
          contextLabel={
            picker.source === 'walkin'
              ? '↻ Pa termin · sot'
              : `${dayLabelLong(weekdayOf(picker.date))}, ${picker.date.split('-').reverse().join('.').slice(0, 5)} · ${picker.time}`
          }
          onClose={() => setPicker(null)}
          onPick={onPatientPicked}
          onAddNew={onAddNewFromPicker}
        />
      ) : null}

      {/* Quick-add modal (chained from picker or global search) */}
      <QuickAddPatientModal
        open={quickAdd !== null}
        seed={quickAdd?.seed}
        onClose={() => setQuickAdd(null)}
        onCreated={onQuickAdded}
        onError={(m) => setToast(m)}
      />

      {/* Booking dialog */}
      {booking && settings ? (
        <BookingDialog
          mode={booking.mode}
          appointmentId={booking.appointmentId}
          patient={booking.patient}
          initialDate={booking.initialDate}
          initialTime={booking.initialTime}
          initialDurationMinutes={booking.initialDurationMinutes}
          hours={settings.hours as HoursConfig}
          prefilledFromSlot={booking.prefilledFromSlot}
          onClose={() => setBooking(null)}
          onBooked={onBooked}
          onError={(msg) => setToast(msg)}
        />
      ) : null}

      {/* Status menu — opened on left-click OR right-click of any
          scheduled card or walk-in chip. */}
      {actionsFor ? (
        <AppointmentActions
          entry={actionsFor.entry}
          anchor={actionsFor.anchor}
          onClose={() => setActionsFor(null)}
          onAction={async (action: EntryAction) => {
            const a = actionsFor.entry;
            setActionsFor(null);
            if (action.kind === 'transition') return applyStatus(a, action.to);
            if (action.kind === 'delete') return onDelete(a);
            if (action.kind === 'reschedule') return onReschedule(a);
            return undefined;
          }}
        />
      ) : null}

      {/* Toast (success / info) */}
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-16 right-6 z-[120] rounded-md border border-line bg-surface-elevated px-4 py-2.5 text-[13px] text-ink shadow-modal"
        >
          {toast}
        </div>
      ) : null}

      {/* Undo toast (post-booking + post-delete) */}
      {undo ? (
        <UndoToast
          message={undo.message}
          secondary={undo.secondary}
          onUndo={runUndo}
          onDismiss={() => setUndo(null)}
        />
      ) : null}
    </main>
  );
}

// =========================================================================
// Top nav wrapper — fetches `/me` and slots the receptionist's
// global search next to the brand.
// =========================================================================

function CalendarTopNav(): ReactElement {
  const { me } = useMe();
  return <ClinicTopNav me={me} />;
}

// =========================================================================
// Week navigation chevron — used in the calendar toolbar to step the
// displayed Monday-anchored week by ±7 days. Matches the design
// reference's `.nav-btn` styling in receptionist.html.
// =========================================================================

function WeekNavButton({
  dir,
  onClick,
  disabled,
}: {
  dir: 'prev' | 'next';
  onClick: () => void;
  disabled?: boolean;
}): ReactElement {
  const label = dir === 'prev' ? 'Java e kaluar' : 'Java tjetër';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-sm border border-line-strong bg-surface-elevated text-ink-muted transition',
        'hover:bg-surface-subtle hover:text-ink',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-elevated disabled:hover:text-ink-muted',
      )}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden
      >
        {dir === 'prev' ? <path d="M10 3l-5 5 5 5" /> : <path d="M6 3l5 5-5 5" />}
      </svg>
    </button>
  );
}

// =========================================================================
// Stats row — `Sot` + `Termini i ardhshëm`
// =========================================================================

interface StatsRowProps {
  stats: CalendarStatsResponse | null;
  now: Date;
}

function formatEur(cents: number): string {
  // Per the design prototype: "€ N.NN", tabular nums. Kosovo runs on
  // the Euro since 2002; clinic payment codes are configured in cents.
  const euros = (cents / 100).toFixed(2);
  return `€ ${euros}`;
}

function StatsRow({ stats, now }: StatsRowProps): ReactElement {
  if (!stats) {
    return (
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SkeletonCard />
        <SkeletonCard />
      </section>
    );
  }
  const firstLast =
    stats.firstStart && stats.lastEnd
      ? `${toLocalParts(new Date(stats.firstStart)).time} → ${toLocalParts(new Date(stats.lastEnd)).time}`
      : null;
  const next = stats.nextAppointment;
  // "Me termin" = scheduled bookings (`scheduledFor` set). The server
  // tells us walk-in count directly; everything else with a slot.
  const withAppointmentCount = Math.max(0, stats.total - stats.walkIn);
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-line bg-surface-elevated px-5 py-4 shadow-xs">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
          Sot
        </div>
        <div className="flex items-baseline gap-4">
          <div className="font-display text-[36px] font-semibold leading-none tracking-tight tabular-nums">
            {stats.total}
          </div>
          <div className="text-[13px] text-ink-muted">
            {stats.total === 1 ? 'vizitë' : 'vizita'}
          </div>
          {stats.walkIn > 0 ? (
            <div className="ml-auto text-[12px] text-ink-faint tabular-nums">
              {withAppointmentCount} me termin · {stats.walkIn} pa termin
            </div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[12px] text-ink-muted">
          <span>
            <strong className="text-ink font-semibold">{stats.completed}</strong> të kryera
          </span>
          {/* In-progress is a sustained state. The receptionist sees
              at a glance whether the doctor is mid-visit so they can
              gauge wait time without opening any chart. Blue dot +
              numerals borrow the dashboard `--in-progress-*` family,
              intentionally distinct from the calendar cards' cyan
              treatment (see design note in chart.html). */}
          <span
            data-testid="stat-foot-in-progress"
            className="inline-flex items-center gap-1.5 rounded-pill border border-in-progress-soft bg-in-progress-bg px-2 py-0.5 text-[12px] text-in-progress-fg"
          >
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-in-progress-dot" />
            <strong className="font-semibold tabular-nums">{stats.inProgress}</strong>{' '}
            në vijim
          </span>
          {/* "Në pritje" = scheduled + arrived. Both states are
              semantically "waiting" (scheduled = waiting for their
              slot; arrived = waiting in the waiting room). Card-level
              differentiation is preserved via canonical colors —
              indigo for scheduled, cyan for arrived — but the summary
              stat collapses them so chip math sums to total across
              every visit-shape mix. Matches the doctor's DayStats "X
              në pritje" by construction. */}
          <span data-testid="stat-foot-waiting">
            <strong className="text-ink font-semibold">{stats.scheduled + stats.arrived}</strong>{' '}
            në pritje
          </span>
          <span>
            <strong className="text-ink font-semibold">{stats.noShow}</strong> mungesë
          </span>
          <span>
            <strong className="text-ink font-semibold">{formatEur(stats.paymentTotalCents)}</strong>{' '}
            pagesa
          </span>
          {firstLast ? (
            <span className="text-ink-faint tabular-nums">{firstLast}</span>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          'rounded-lg border border-teal-200 bg-gradient-to-b from-primary-tint to-surface-elevated px-5 py-4 shadow-xs',
          'flex items-center justify-between',
        )}
      >
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-muted">
            Termini i ardhshëm
          </div>
          {next ? (
            <>
              <div className="font-display text-[22px] font-semibold tracking-[-0.015em] text-ink-strong">
                {next.patient.firstName} {next.patient.lastName}
              </div>
              <div className="mt-0.5 text-[13px] text-ink-muted tabular-nums">
                DL {next.patient.dateOfBirth ? next.patient.dateOfBirth.split('-').reverse().join('.') : '—'} · {next.durationMinutes} min
              </div>
            </>
          ) : (
            <div className="font-display text-[22px] font-semibold text-ink-muted">
              Nuk ka termin tjetër sot
            </div>
          )}
        </div>
        {next ? <NextCountdown scheduledFor={next.scheduledFor} now={now} /> : null}
      </div>
    </section>
  );
}

function NextCountdown({
  scheduledFor,
  now,
}: {
  scheduledFor: string;
  now: Date;
}): ReactElement {
  const start = new Date(scheduledFor);
  const ms = start.getTime() - now.getTime();
  const minutes = Math.round(ms / 60_000);
  const label =
    minutes < 0
      ? 'tani'
      : minutes < 1
        ? 'tani'
        : minutes === 1
          ? 'pas 1 minute'
          : minutes < 60
            ? `pas ${minutes} minutash`
            : minutes < 120
              ? `pas ${Math.round(minutes / 60)} ore`
              : `pas ${Math.round(minutes / 60)} orësh`;
  return (
    <div className="text-right tabular-nums">
      <div className="font-display text-[28px] font-semibold tracking-tight">
        {toLocalParts(start).time}
      </div>
      <span className="mt-1 inline-block rounded-pill bg-primary-soft px-2 py-0.5 text-[12px] font-medium text-primary-dark">
        {label}
      </span>
    </div>
  );
}

function SkeletonCard(): ReactElement {
  return (
    <div className="h-[112px] rounded-lg border border-line bg-surface-elevated shadow-xs" />
  );
}

/**
 * Calendar grid skeleton — 5 day-columns with a head + body of pulsing
 * slots of varying heights, matching design-reference/prototype/
 * components/loading-skeletons.html §8.3.
 */
function CalendarSkeleton(): ReactElement {
  const columns = [
    ['md', 'tall', 'short', 'md', 'md', 'tall'],
    ['tall', 'md', 'short', 'md', 'tall', 'short'],
    ['md', 'md', 'tall', 'short', 'md'],
    ['short', 'tall', 'md', 'md', 'tall'],
    ['md', 'short', 'tall', 'md'],
  ] as const;
  const slotHeight: Record<'md' | 'tall' | 'short', string> = {
    md: 'h-8',
    tall: 'h-14',
    short: 'h-[22px]',
  };
  return (
    <div
      role="status"
      aria-label="Po ngarkohet kalendari"
      className="flex gap-4 overflow-x-auto px-2 py-3"
    >
      {columns.map((slots, ci) => (
        <div
          key={ci}
          className="flex-none w-[200px] overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
        >
          <div className="flex flex-col gap-1.5 border-b border-line px-3.5 py-2.5">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-[18px] w-8" />
          </div>
          <div className="flex flex-col gap-2 p-3">
            {slots.map((s, i) => (
              <Skeleton key={i} className={slotHeight[s]} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// =========================================================================
// End-of-day dropdown
// =========================================================================

interface UnmarkedDropdownProps {
  items: CalendarEntry[];
  onMark: (a: CalendarEntry, status: 'completed' | 'no_show') => void;
}

function UnmarkedDropdown({ items, onMark }: UnmarkedDropdownProps): ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent): void {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  return (
    <div ref={containerRef} className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        Shëno status
      </Button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[300px] overflow-hidden rounded-md border border-line bg-surface-elevated shadow-modal">
          {items.map((a) => (
            <div key={a.id} className="border-b border-line-soft last:border-b-0 px-3 py-2">
              <div className="text-[13px] font-semibold text-ink-strong">
                {a.patient.firstName} {a.patient.lastName}
              </div>
              <div className="text-[11.5px] text-ink-muted tabular-nums">
                {a.scheduledFor
                  ? `${formatLongAlbanianDate(toLocalParts(new Date(a.scheduledFor)).date)} · ${toLocalParts(new Date(a.scheduledFor)).time}`
                  : ''}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="rounded border border-line-strong bg-surface-elevated px-2 py-1 text-[11.5px] text-ink-strong hover:bg-surface-subtle"
                  onClick={() => {
                    onMark(a, 'completed');
                    setOpen(false);
                  }}
                >
                  Kryer
                </button>
                <button
                  type="button"
                  className="rounded border border-line-strong bg-surface-elevated px-2 py-1 text-[11.5px] text-ink-strong hover:bg-surface-subtle"
                  onClick={() => {
                    onMark(a, 'no_show');
                    setOpen(false);
                  }}
                >
                  Mungoi
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
