'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import {
  addLocalDays,
  appointmentClient,
  type AppointmentDto,
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
import { BookingDialog } from './booking-dialog';
import { CalendarGrid, type DayColumn } from './calendar-grid';
import { PatientPicker } from './patient-picker';

const DAYS_TO_SHOW = 6;
const STATS_POLL_MS = 30_000;

interface UndoState {
  id: string;
  patientName: string;
  restorableUntil: string;
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

  const [picker, setPicker] = useState<{
    date: string;
    time: string;
    anchor: { x: number; y: number };
  } | null>(null);
  const [booking, setBooking] = useState<{
    patient: PatientPublicDto;
    date: string;
    time: string;
  } | null>(null);
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
        // If today is closed, still surface it as the leftmost column so
        // the receptionist sees today's state (matches the prototype's
        // "today + N open" rule).
        out.push({
          date: cursor,
          weekday: dow,
          open: false,
          startTime: '10:00',
          endTime: '18:00',
        });
      }
      cursor = addLocalDays(cursor, 1);
      // Bail-out: defensive cap so a misconfigured "all-closed" clinic
      // doesn't lock the loop.
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

  // ----- Initial load: clinic settings + appointments + stats + unmarked
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
      // The browser auto-reconnects. Fall back to polling-only.
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

  // ----- Slot click → patient picker
  const onSlotClick = useCallback(
    (params: { date: string; time: string }) => {
      setActionsFor(null);
      // Anchor under the clicked column header. We use the last
      // mousedown coords stashed via the document handler below.
      const anchor = lastMouseRef.current ?? { x: window.innerWidth / 2, y: 120 };
      setPicker({ ...params, anchor });
    },
    [],
  );

  const lastMouseRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    function onMove(e: MouseEvent): void {
      lastMouseRef.current = { x: e.clientX, y: e.clientY };
    }
    window.addEventListener('mousedown', onMove);
    return () => window.removeEventListener('mousedown', onMove);
  }, []);

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
        });
      } catch {
        setToast('Fshirja dështoi.');
      }
    },
    [refreshAppointments, refreshStats],
  );

  const undoDelete = useCallback(async () => {
    if (!undo) return;
    try {
      await appointmentClient.restore(undo.id);
      await refreshAppointments();
      await refreshStats();
      setToast(`Termini i ${undo.patientName} u rikthye.`);
    } catch {
      setToast('Rikthimi dështoi.');
    } finally {
      setUndo(null);
    }
  }, [refreshAppointments, refreshStats, undo]);

  // Auto-dismiss the undo toast after 30s (matches the server's restorableUntil).
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

  // ----- End-of-day prompt (yesterday's unmarked)
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
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface-elevated">
        <div className="mx-auto flex max-w-page items-center justify-between px-page-x py-3">
          <div className="flex items-center gap-8">
            <Link href="/receptionist" className="font-display text-[17px] font-semibold tracking-[-0.015em] text-ink-strong">
              klinika<span className="text-primary">.</span>
            </Link>
            <nav className="flex items-center gap-5 text-[14px]">
              <Link href="/receptionist" className="font-medium text-ink-strong">
                Kalendari
              </Link>
              <Link href="/receptionist/pacientet" className="text-ink-muted hover:text-ink">
                Pacientët
              </Link>
              <Link href="/cilesimet" className="text-ink-muted hover:text-ink">
                Cilësimet
              </Link>
            </nav>
          </div>
          <Link href="/profili-im" className="text-[13px] text-ink-muted hover:text-ink">
            Profili im →
          </Link>
        </div>
      </header>

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
            <div className="grid place-items-center px-6 py-12 text-[13px] text-ink-muted">
              Po ngarkohet…
            </div>
          )}
        </section>
      </div>

      {/* Picker popover */}
      {picker ? (
        <PatientPicker
          anchor={picker.anchor}
          contextLabel={`${dayLabelLong(weekdayOf(picker.date))}, ${picker.date.split('-').reverse().join('.').slice(0, 5)} · ${picker.time}`}
          onClose={() => setPicker(null)}
          onPick={(p) => {
            setBooking({ patient: p, date: picker.date, time: picker.time });
            setPicker(null);
          }}
          onAddNew={() => {
            setPicker(null);
            setToast(
              'Shtimi i pacientit të ri vjen me slice-09. Përdorni faqen Pacientët për ndërkohë.',
            );
          }}
        />
      ) : null}

      {/* Booking dialog */}
      {booking && settings ? (
        <BookingDialog
          patient={booking.patient}
          date={booking.date}
          time={booking.time}
          hours={settings.hours as HoursConfig}
          onClose={() => setBooking(null)}
          onBooked={() => {
            setBooking(null);
            setToast('Termini u caktua.');
            void refreshAppointments();
            void refreshStats();
          }}
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
            if (action === 'reschedule') {
              setToast('Riprogramimi vjen me slice-09. Përdor zvarritjen e termineve.');
            }
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

      {/* Undo toast */}
      {undo ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[120] flex items-center gap-3 rounded-md border border-line bg-surface-elevated px-4 py-2.5 text-[13px] text-ink shadow-modal"
        >
          <span>
            Termini i {undo.patientName} u fshi.
          </span>
          <button
            type="button"
            onClick={undoDelete}
            className="font-medium text-primary-dark hover:underline"
          >
            Anulo
          </button>
        </div>
      ) : null}
    </main>
  );
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
