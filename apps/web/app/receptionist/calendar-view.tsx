'use client';

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
  type AppointmentDto,
  appointmentClient,
  type AppointmentStatsResponse,
  dayLabelLong,
  formatLongAlbanianDate,
  formatRangeAlbanian,
  todayIsoLocal,
  toLocalParts,
  weekdayOf,
} from '@/lib/appointment-client';
import { clinicClient, type ClinicSettings, type HoursConfig } from '@/lib/clinic-client';
import type { PatientPublicDto } from '@/lib/patient-client';

import { AppointmentActions } from './appointment-actions';
import { BookingDialog, type BookingDialogResult } from './booking-dialog';
import { CalendarGrid, type DayColumn } from './calendar-grid';
import { GlobalPatientSearch } from './global-patient-search';
import { QuickAddPatientModal } from './pacientet/quick-add-patient-modal';
import { PatientPicker } from './patient-picker';

const DAYS_TO_SHOW = 6;
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
  /** Context that opened the picker. */
  source: 'slot' | 'global';
  date: string;
  time: string;
  anchor: { x: number; y: number };
}

interface QuickAddState {
  seed: string;
  /** Where to route the new patient on success. */
  returnTo: { date: string; time: string; prefilledFromSlot: boolean };
}

export function CalendarView(): ReactElement {
  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [appointments, setAppointments] = useState<AppointmentDto[]>([]);
  const [stats, setStats] = useState<AppointmentStatsResponse | null>(null);
  const [unmarked, setUnmarked] = useState<AppointmentDto[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);

  const [picker, setPicker] = useState<PickerState | null>(null);
  const [booking, setBooking] = useState<BookingState | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [actionsFor, setActionsFor] = useState<{
    appointment: AppointmentDto;
    anchor: { x: number; y: number };
  } | null>(null);

  const todayIso = useMemo(() => todayIsoLocal(now), [now]);

  // ----- Columns: today + next 5 OPEN days (skipping clinic-closed days)
  const columns: DayColumn[] = useMemo(() => {
    if (!settings) return [];
    const hours = settings.hours;
    const out: DayColumn[] = [];
    let cursor = todayIso;
    while (out.length < DAYS_TO_SHOW) {
      const dow = weekdayOf(cursor);
      const day = hours.days[dow];
      if (day.open) {
        out.push({
          date: cursor,
          weekday: dow,
          open: true,
          startTime: day.start,
          endTime: day.end,
        });
      } else if (cursor === todayIso) {
        out.push({
          date: cursor,
          weekday: dow,
          open: false,
          startTime: '10:00',
          endTime: '18:00',
        });
      }
      cursor = addLocalDays(cursor, 1);
      if (out.length === 0 && cursor > addLocalDays(todayIso, 14)) break;
      if (cursor > addLocalDays(todayIso, 60)) break;
    }
    return out;
  }, [settings, todayIso]);

  const rangeFrom = columns[0]?.date ?? todayIso;
  const rangeTo = columns[columns.length - 1]?.date ?? todayIso;
  const rangeLabel = useMemo(
    () =>
      columns.length > 0 ? formatRangeAlbanian(rangeFrom, rangeTo) : 'Pa data',
    [columns.length, rangeFrom, rangeTo],
  );

  const refreshAppointments = useCallback(async () => {
    if (columns.length === 0) return;
    try {
      const res = await appointmentClient.list(rangeFrom, rangeTo);
      setAppointments(res.appointments);
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
      const res = await appointmentClient.stats(todayIso);
      setStats(res);
    } catch {
      // Stats are non-fatal — keep the previous snapshot.
    }
  }, [todayIso]);

  const refreshUnmarked = useCallback(async () => {
    try {
      const res = await appointmentClient.unmarkedPast();
      setUnmarked(res.appointments);
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
    void refreshAppointments();
    void refreshStats();
    void refreshUnmarked();
  }, [refreshAppointments, refreshStats, refreshUnmarked]);

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

  // ----- SSE: real-time updates from the doctor (visit save → completed)
  useEffect(() => {
    const url = appointmentClient.streamUrl();
    const source = new EventSource(url, { withCredentials: true });
    const onAny = (): void => {
      void refreshAppointments();
      void refreshStats();
    };
    source.addEventListener('appointment.created', onAny);
    source.addEventListener('appointment.updated', onAny);
    source.addEventListener('appointment.deleted', onAny);
    source.onerror = () => {
      // Browser auto-reconnects; fall back to polling-only.
    };
    return () => source.close();
  }, [refreshAppointments, refreshStats]);

  // ----- Tab/window focus: invalidate caches.
  useEffect(() => {
    function onVis(): void {
      if (document.visibilityState === 'visible') {
        void refreshAppointments();
        void refreshStats();
        void refreshUnmarked();
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshAppointments, refreshStats, refreshUnmarked]);

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

  // ----- Appointment click → action menu
  const onAppointmentClick = useCallback(
    (appointment: AppointmentDto, anchor: { x: number; y: number }) => {
      setPicker(null);
      setActionsFor({ appointment, anchor });
    },
    [],
  );

  // ----- Status / delete actions
  const applyStatus = useCallback(
    async (
      appointment: AppointmentDto,
      next: 'completed' | 'no_show' | 'cancelled',
    ) => {
      try {
        await appointmentClient.update(appointment.id, { status: next });
        await refreshAppointments();
        await refreshStats();
        await refreshUnmarked();
        const labels = {
          completed: 'i shënuar si kryer',
          no_show: 'i shënuar si mungesë',
          cancelled: 'i anuluar',
        } as const;
        setToast(`Termini ${labels[next]}.`);
      } catch {
        setToast('Veprimi dështoi.');
      }
    },
    [refreshAppointments, refreshStats, refreshUnmarked],
  );

  const onDelete = useCallback(
    async (appointment: AppointmentDto) => {
      try {
        const res = await appointmentClient.softDelete(appointment.id);
        await refreshAppointments();
        await refreshStats();
        setUndo({
          id: appointment.id,
          patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
          restorableUntil: res.restorableUntil,
          message: 'Termini u fshi.',
          secondary: `${appointment.patient.firstName} ${appointment.patient.lastName} · ${toLocalParts(new Date(appointment.scheduledFor)).time}`,
          intent: 'restore-deleted',
        });
      } catch {
        setToast('Fshirja dështoi.');
      }
    },
    [refreshAppointments, refreshStats],
  );

  // ----- Edit existing appointment (open booking dialog in edit mode)
  const onReschedule = useCallback((appointment: AppointmentDto) => {
    const local = toLocalParts(new Date(appointment.scheduledFor));
    setBooking({
      mode: 'edit',
      appointmentId: appointment.id,
      patient: {
        id: appointment.patientId,
        firstName: appointment.patient.firstName,
        lastName: appointment.patient.lastName,
        dateOfBirth: appointment.patient.dateOfBirth,
      },
      initialDate: local.date,
      initialTime: local.time,
      initialDurationMinutes: appointment.durationMinutes,
      prefilledFromSlot: false,
    });
  }, []);

  // ----- Undo handling for both flows (delete-undo + post-booking undo)
  const runUndo = useCallback(async () => {
    if (!undo) return;
    try {
      if (undo.intent === 'restore-deleted') {
        await appointmentClient.restore(undo.id);
        setToast(`Termini i ${undo.patientName} u rikthye.`);
      } else {
        await appointmentClient.softDelete(undo.id);
        setToast('Termini u anulua.');
      }
      await refreshAppointments();
      await refreshStats();
    } catch {
      setToast('Anulimi dështoi.');
    } finally {
      setUndo(null);
    }
  }, [refreshAppointments, refreshStats, undo]);

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

  // ----- Patient picker → booking flow
  const onPatientPicked = useCallback(
    (p: PatientPublicDto) => {
      if (!picker) return;
      setBooking({
        mode: 'create',
        patient: p,
        initialDate: picker.date,
        initialTime: picker.time,
        // Slot-first carries time + date from the tap. Patient-first
        // carries today's date but leaves time blank.
        prefilledFromSlot: picker.source === 'slot',
      });
      setPicker(null);
    },
    [picker],
  );

  const onAddNewFromPicker = useCallback(
    (query: string) => {
      if (!picker) return;
      setQuickAdd({
        seed: query,
        returnTo: {
          date: picker.date,
          time: picker.time,
          prefilledFromSlot: picker.source === 'slot',
        },
      });
      setPicker(null);
    },
    [picker],
  );

  const onQuickAdded = useCallback(
    (p: PatientPublicDto) => {
      if (!quickAdd) {
        setQuickAdd(null);
        return;
      }
      setBooking({
        mode: 'create',
        patient: p,
        initialDate: quickAdd.returnTo.date,
        initialTime: quickAdd.returnTo.time,
        prefilledFromSlot: quickAdd.returnTo.prefilledFromSlot,
      });
      setQuickAdd(null);
    },
    [quickAdd],
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
        returnTo: { date: todayIso, time: '', prefilledFromSlot: false },
      });
    },
    [todayIso],
  );

  // ----- Booking submitted (success path for both paths and edit mode)
  const onBooked = useCallback(
    (result: BookingDialogResult) => {
      const apt = result.appointment;
      const isEdit = booking?.mode === 'edit';
      setBooking(null);
      void refreshAppointments();
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
    [booking?.mode, refreshAppointments, refreshStats, refreshUnmarked],
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
      {/* Top bar — role-filtered (ADR-004). The receptionist's global
          patient search lives in the brand-adjacent slot. */}
      <CalendarTopNav
        searchSlot={
          <GlobalPatientSearch
            onPick={openGlobalPickerForPatient}
            onAddNew={openGlobalQuickAdd}
          />
        }
      />

      <div className="mx-auto max-w-page px-page-x pt-6">
        {/* Greeting */}
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-ink-strong">
              Mirëdita.
            </h1>
            <p className="mt-1 text-[14px] text-ink-muted">
              {formatLongAlbanianDate(todayIso)}
              {settings ? ` · ${settings.general.shortName}` : ''}
            </p>
          </div>
        </div>

        {/* Stats */}
        <StatsRow stats={stats} now={now} />

        {/* End-of-day prompt */}
        {promptCount > 0 ? (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900"
            role="status"
            aria-live="polite"
          >
            <span>
              <strong className="font-semibold">{promptCount}</strong>{' '}
              {promptCount === 1
                ? 'termin i djeshëm është pa status. Shëno tani?'
                : 'termine të djeshme janë pa status. Shëno tani?'}
            </span>
            <UnmarkedDropdown
              items={unmarked}
              onMark={(a, status) => applyStatus(a, status)}
            />
          </div>
        ) : null}

        {/* Calendar card */}
        <section className="mt-5 overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
          <div className="flex items-center justify-between border-b border-line bg-surface-elevated px-5 py-3.5">
            <div className="flex items-center gap-3">
              <div className="font-display text-[17px] font-semibold tracking-[-0.015em]">
                {rangeLabel}
              </div>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-primary" />
                Planifikuar
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-success" />
                Kryer
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-danger/80" />
                Mungesë
              </span>
            </div>
          </div>

          {settings && columns.length > 0 ? (
            <CalendarGrid
              todayIso={todayIso}
              now={now}
              hours={settings.hours}
              columns={columns}
              appointments={appointments}
              onSlotClick={onSlotClick}
              onAppointmentClick={onAppointmentClick}
            />
          ) : (
            <CalendarSkeleton />
          )}
        </section>
      </div>

      {/* Picker popover (Path 1) */}
      {picker ? (
        <PatientPicker
          anchor={picker.anchor}
          contextLabel={`${dayLabelLong(weekdayOf(picker.date))}, ${picker.date.split('-').reverse().join('.').slice(0, 5)} · ${picker.time}`}
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

      {/* Appointment action menu */}
      {actionsFor ? (
        <AppointmentActions
          appointment={actionsFor.appointment}
          anchor={actionsFor.anchor}
          onClose={() => setActionsFor(null)}
          onAction={async (action) => {
            const a = actionsFor.appointment;
            setActionsFor(null);
            if (action === 'complete') return applyStatus(a, 'completed');
            if (action === 'no_show') return applyStatus(a, 'no_show');
            if (action === 'cancelled') return applyStatus(a, 'cancelled');
            if (action === 'delete') return onDelete(a);
            if (action === 'reschedule') return onReschedule(a);
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

function CalendarTopNav({ searchSlot }: { searchSlot: ReactElement }): ReactElement {
  const { me } = useMe();
  return <ClinicTopNav me={me} brandAdjacent={searchSlot} />;
}

// =========================================================================
// Stats row — `Sot` + `Termini i ardhshëm`
// =========================================================================

interface StatsRowProps {
  stats: AppointmentStatsResponse | null;
  now: Date;
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
          <div className="text-[13px] text-ink-muted">termine të planifikuara</div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[12px] text-ink-muted">
          <span>
            <strong className="text-ink font-semibold">{stats.completed}</strong> të kryera
          </span>
          <span>
            <strong className="text-ink font-semibold">{stats.noShow}</strong> mungesë
          </span>
          <span>
            <strong className="text-ink font-semibold">{stats.scheduled}</strong> në pritje
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
  items: AppointmentDto[];
  onMark: (a: AppointmentDto, status: 'completed' | 'no_show' | 'cancelled') => void;
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
                {formatLongAlbanianDate(toLocalParts(new Date(a.scheduledFor)).date)} ·{' '}
                {toLocalParts(new Date(a.scheduledFor)).time}
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
                <button
                  type="button"
                  className="rounded border border-line-strong bg-surface-elevated px-2 py-1 text-[11.5px] text-ink-strong hover:bg-surface-subtle"
                  onClick={() => {
                    onMark(a, 'cancelled');
                    setOpen(false);
                  }}
                >
                  Anulluar
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
