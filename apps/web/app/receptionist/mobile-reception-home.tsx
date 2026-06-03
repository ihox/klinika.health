'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ClinicTopNav } from '@/components/clinic-top-nav';
import { BottomSheet } from '@/components/mobile/bottom-sheet';
import { NavIcon } from '@/components/mobile/nav-icon';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';
import { useBreakpoint } from '@/lib/hooks/use-breakpoint';
import {
  addLocalDays,
  formatLongAlbanianDate,
  mondayOfWeekIso,
  todayIsoLocal,
  toLocalParts,
} from '@/lib/appointment-client';
import { ageLabel, type PatientPublicDto } from '@/lib/patient-client';
import { clinicClient, type ClinicSettings } from '@/lib/clinic-client';
import { QuickAddPatientModal } from './pacientet/quick-add-patient-modal';
import { MobileWalkInSheet } from './mobile-walkin-sheet';
import {
  ALLOWED_TRANSITIONS,
  calendarClient,
  isReceptionistOnlyRole,
  isVisitLockedForReceptionist,
  type CalendarEntry,
  type CalendarStatsResponse,
  type VisitStatus,
} from '@/lib/visits-calendar-client';
import {
  countByStatusFilter,
  entryMatchesStatusFilter,
  type StatusFilter,
} from './status-filters';
import { cn } from '@/lib/utils';

const STATS_POLL_MS = 30_000;
const VISIBLE_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const WEEKDAY_SHORT: Record<string, string> = {
  mon: 'Hën',
  tue: 'Mar',
  wed: 'Mër',
  thu: 'Enj',
  fri: 'Pre',
  sat: 'Sht',
  sun: 'Die',
};

/** "Mark as …" action label per target status (matches the desktop toasts). */
const STATUS_ACTION_LABEL: Record<VisitStatus, string> = {
  scheduled: 'planifikuar',
  arrived: 'paraqitur',
  in_progress: 'në vizitë',
  completed: 'kryer',
  no_show: 'mungesë',
};

/**
 * Mobile + tablet receptionist home (handoff §5 / §13.1). Mounted only
 * below desktop (the wrapper renders the untouched desktop CalendarView at
 * ≥1280px), so this owns its own lightweight data layer rather than
 * retrofitting the 1279-line desktop grid.
 *
 *   - phone / tablet portrait → day-list agenda
 *   - tablet landscape → defaults to a compact week grid; Ditë/Javë toggle
 *     switches to the day-list. Toggle is tablet-only.
 *
 * Privacy (§1.2): receptionist sees name + DOB-derived age + time + status
 * + walk-in/new-patient tags only. No payment, no clinical reason — the
 * CalendarEntry never carries them for a receptionist session anyway.
 *
 * Appointment scheduling + walk-in CREATION are Phase 3; this surface is
 * the day/week VIEW plus status management (mark arrived/në vizitë/kryer/
 * mungesë), which is core daily reception work.
 */
export function MobileReceptionHome() {
  const { me } = useMe();
  const { isTabletLandscape } = useBreakpoint();
  const receptionistOnly = isReceptionistOnlyRole(me?.roles ?? null);

  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [stats, setStats] = useState<CalendarStatsResponse | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionEntry, setActionEntry] = useState<CalendarEntry | null>(null);
  const [walkInOpen, setWalkInOpen] = useState(false);
  // string seed = QuickAdd open (carrying the typed name); null = closed.
  const [quickAddSeed, setQuickAddSeed] = useState<string | null>(null);

  const todayIso = useMemo(() => todayIsoLocal(now), [now]);
  const [selectedDay, setSelectedDay] = useState<string>(() => todayIsoLocal(new Date()));

  // Ditë / Javë view. Tablet landscape defaults to the week grid; phone +
  // tablet portrait are always day-list. Once the user picks a view we stop
  // auto-following the breakpoint default.
  const [view, setView] = useState<'day' | 'week'>('day');
  const userPickedView = useRef(false);
  useEffect(() => {
    if (userPickedView.current) return;
    setView(isTabletLandscape ? 'week' : 'day');
  }, [isTabletLandscape]);
  const pickView = useCallback((next: 'day' | 'week') => {
    userPickedView.current = true;
    setView(next);
  }, []);

  // Fetch range tracks the active view: a single day for the agenda, the
  // Mon–Sat week for the grid.
  const weekStart = useMemo(() => mondayOfWeekIso(selectedDay), [selectedDay]);
  const range = useMemo(() => {
    if (view === 'week') {
      return { from: weekStart, to: addLocalDays(weekStart, 5) };
    }
    return { from: selectedDay, to: selectedDay };
  }, [view, weekStart, selectedDay]);

  const refreshEntries = useCallback(async () => {
    try {
      const res = await calendarClient.list(range.from, range.to);
      setEntries(res.entries);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?reason=session-expired';
        return;
      }
      setError('Nuk u ngarkuan terminet.');
    }
  }, [range.from, range.to]);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await calendarClient.stats(todayIso));
    } catch {
      // Non-fatal — keep the previous snapshot.
    }
  }, [todayIso]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
  }, [refreshEntries]);
  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  // now tick (1 min) + stats poll (30s) + SSE + focus refresh — mirrors the
  // desktop calendar so a status change elsewhere reflects here in near-real-time.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const id = window.setInterval(() => void refreshStats(), STATS_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshStats]);
  useEffect(() => {
    const source = new EventSource(calendarClient.streamUrl(), { withCredentials: true });
    const onAny = (): void => {
      void refreshEntries();
      void refreshStats();
    };
    for (const ev of [
      'visit.created',
      'visit.updated',
      'visit.status_changed',
      'visit.deleted',
      'visit.restored',
    ]) {
      source.addEventListener(ev, onAny);
    }
    source.onerror = () => {
      // Browser auto-reconnects; polling is the fallback.
    };
    return () => source.close();
  }, [refreshEntries, refreshStats]);
  useEffect(() => {
    function onVis(): void {
      if (document.visibilityState === 'visible') {
        void refreshEntries();
        void refreshStats();
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshEntries, refreshStats]);

  const isLocked = useCallback(
    (entry: CalendarEntry): boolean =>
      receptionistOnly && isVisitLockedForReceptionist(entry, todayIso),
    [receptionistOnly, todayIso],
  );

  const changeStatus = useCallback(
    async (entry: CalendarEntry, next: VisitStatus) => {
      setActionEntry(null);
      try {
        await calendarClient.changeStatus(entry.id, next);
        setToast(`Termini i shënuar si ${STATUS_ACTION_LABEL[next]}.`);
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : 'Veprimi dështoi.');
      } finally {
        void refreshEntries();
        void refreshStats();
      }
    },
    [refreshEntries, refreshStats],
  );

  // Walk-in creation (§12.5). Creates the visit immediately and returns to
  // the calendar — the clinical visit form is never shown to reception
  // (§1.2). The doctor picks it up from their own list.
  const createWalkin = useCallback(
    async (patientId: string) => {
      setWalkInOpen(false);
      setQuickAddSeed(null);
      try {
        await calendarClient.createWalkin({ patientId });
        setToast('Pacienti u shtua. Shfaqet menjëherë në kalendar.');
      } catch (err) {
        setToast(err instanceof ApiError ? err.message : 'Walk-in dështoi.');
      } finally {
        void refreshEntries();
        void refreshStats();
      }
    },
    [refreshEntries, refreshStats],
  );

  // Day-list partitions: scheduled bookings (agenda) vs walk-ins (band).
  const agenda = useMemo(
    () =>
      entries
        .filter((e) => !e.isWalkIn)
        .filter((e) => entryMatchesStatusFilter(e, statusFilter))
        .sort((a, b) => entryStartMs(a) - entryStartMs(b)),
    [entries, statusFilter],
  );
  const walkIns = useMemo(
    () => entries.filter((e) => e.isWalkIn).sort((a, b) => entryStartMs(a) - entryStartMs(b)),
    [entries],
  );
  const filterCounts = useMemo(
    () => countByStatusFilter(entries.filter((e) => !e.isWalkIn)),
    [entries],
  );

  const onToday = selectedDay === todayIso;

  return (
    <main className="min-h-screen bg-surface">
      <ClinicTopNav me={me} />

      <div className="mx-auto w-full max-w-3xl px-[var(--m-gutter)] pt-4 md:px-[var(--m-gutter-lg)] md:pt-6">
        {error ? (
          <div
            role="status"
            className="mb-3 rounded-md border border-status-no-show-border bg-status-no-show-bg px-3 py-2 text-[13px] text-status-no-show-fg"
          >
            {error}
          </div>
        ) : null}

        <StatCards stats={stats} now={now} />

        {/* Walk-in — the receptionist's primary mobile action (§12.5).
            Prominent full-width button right under the stats; a FAB below
            mirrors it for one-thumbed reach. */}
        <button
          type="button"
          onClick={() => setWalkInOpen(true)}
          data-testid="walkin-cta"
          className="mt-4 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-white shadow-sm transition active:bg-primary-dark [-webkit-tap-highlight-color:transparent]"
        >
          <NavIcon name="plus" size={18} strokeWidth={2} />
          Vizitë pa termin
        </button>

        {/* Ditë / Javë — tablet only (phone is always the day-list). */}
        <div className="mt-4 hidden md:flex md:justify-end">
          <ViewToggle view={view} onPick={pickView} />
        </div>

        {view === 'week' ? (
          <WeekGrid
            entries={entries}
            settings={settings}
            weekStart={weekStart}
            todayIso={todayIso}
            onPick={(e) => setActionEntry(e)}
          />
        ) : (
          <>
            <DayStrip
              selectedDay={selectedDay}
              onToday={onToday}
              onPrev={() => setSelectedDay((d) => addLocalDays(d, -1))}
              onNext={() => setSelectedDay((d) => addLocalDays(d, 1))}
              onJumpToday={() => setSelectedDay(todayIso)}
            />

            <FilterPills active={statusFilter} counts={filterCounts} onChange={setStatusFilter} />

            <section className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="text-[13px] font-semibold text-ink-strong">Axhenda e ditës</h2>
                <span className="text-[12px] text-ink-muted">
                  {agenda.length} {agenda.length === 1 ? 'vizitë' : 'vizita'}
                </span>
              </div>
              {agenda.length === 0 ? (
                <div className="px-4 py-10 text-center">
                  <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-surface-subtle text-ink-faint">
                    <NavIcon name="calendar" size={20} />
                  </div>
                  <div className="text-[13.5px] font-medium text-ink">
                    {statusFilter === 'all' ? 'Asnjë termin për këtë ditë' : 'Asnjë vizitë'}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-ink-muted">
                    Zgjidh një ditë tjetër ose ndrysho filtrin.
                  </div>
                </div>
              ) : (
                <ul>
                  {agenda.map((e) => (
                    <AgendaRow
                      key={e.id}
                      entry={e}
                      locked={isLocked(e)}
                      onTap={() => setActionEntry(e)}
                    />
                  ))}
                </ul>
              )}
            </section>

            {onToday && walkIns.length > 0 ? (
              <WalkInBand walkIns={walkIns} locked={isLocked} onTap={(e) => setActionEntry(e)} />
            ) : null}
          </>
        )}
      </div>

      {/* FAB — thumb-reachable walk-in entry (day view, above the tab bar). */}
      {view === 'day' ? (
        <button
          type="button"
          onClick={() => setWalkInOpen(true)}
          aria-label="Vizitë pa termin"
          data-testid="walkin-fab"
          className="fixed bottom-[calc(var(--m-tabbar-h)+env(safe-area-inset-bottom,0px)+16px)] right-[var(--m-gutter)] z-30 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-white shadow-lg transition active:scale-95 md:hidden"
        >
          <NavIcon name="plus" size={24} strokeWidth={2} />
        </button>
      ) : null}

      {toast ? <Toast key={toast} message={toast} onDone={() => setToast(null)} /> : null}

      <StatusActionSheet
        entry={actionEntry}
        locked={actionEntry ? isLocked(actionEntry) : false}
        onClose={() => setActionEntry(null)}
        onChange={changeStatus}
      />

      <MobileWalkInSheet
        open={walkInOpen}
        onClose={() => setWalkInOpen(false)}
        onPickPatient={(p) => void createWalkin(p.id)}
        onCreateNew={(seed) => {
          setWalkInOpen(false);
          setQuickAddSeed(seed);
        }}
      />

      <QuickAddPatientModal
        open={quickAddSeed != null}
        seed={quickAddSeed ?? ''}
        onClose={() => setQuickAddSeed(null)}
        onCreated={(p: PatientPublicDto) => void createWalkin(p.id)}
      />
    </main>
  );
}

// ── Stat cards ─────────────────────────────────────────────────────────────

function StatCards({
  stats,
  now,
}: {
  stats: CalendarStatsResponse | null;
  now: Date;
}) {
  const total = stats?.total ?? 0;
  const completed = stats?.completed ?? 0;
  const walkIn = stats?.walkIn ?? 0;
  const next = stats?.nextAppointment ?? null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {/* Sot */}
      <div className="rounded-lg border border-teal-200 bg-gradient-to-br from-primary-tint to-surface-elevated p-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary-dark">
          Sot
        </div>
        <div className="mt-1 font-display text-[30px] font-semibold leading-none tracking-tight tabular-nums text-ink-strong">
          {total}
          <span className="ml-1.5 text-[13px] font-normal tracking-normal text-ink-muted">
            {total === 1 ? 'vizitë' : 'vizita'}
          </span>
        </div>
        <div className="mt-2 text-[12px] text-ink-muted">
          <strong className="font-semibold text-ink">{completed}</strong> kryer
          {walkIn > 0 ? (
            <>
              {' · '}
              <strong className="font-semibold text-ink">{walkIn}</strong> pa termin
            </>
          ) : null}
        </div>
      </div>

      {/* Termini i ardhshëm */}
      <div className="rounded-lg border border-line bg-surface-elevated p-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-faint">
          Termini i ardhshëm
        </div>
        {next ? (
          <>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <div className="min-w-0 truncate font-display text-[16px] font-semibold text-ink-strong">
                {next.patient.firstName} {next.patient.lastName}
              </div>
              <div className="shrink-0 font-display text-[20px] font-semibold tabular-nums text-ink-strong">
                {toLocalParts(new Date(next.scheduledFor)).time}
              </div>
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-[12px] text-ink-muted">
              <span>{next.durationMinutes} min</span>
              <span className="rounded-pill bg-surface-subtle px-2 py-0.5 text-[11.5px] text-ink-muted">
                {relativeLabel(new Date(next.scheduledFor), now)}
              </span>
            </div>
          </>
        ) : (
          <div className="mt-2 text-[14px] text-ink-muted">Nuk ka termin tjetër sot</div>
        )}
      </div>
    </div>
  );
}

// ── Ditë / Javë toggle (tablet) ──────────────────────────────────────────────

function ViewToggle({
  view,
  onPick,
}: {
  view: 'day' | 'week';
  onPick: (v: 'day' | 'week') => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Ndërro pamjen"
      className="inline-flex rounded-md border border-line-strong bg-surface-subtle p-0.5"
    >
      {(['day', 'week'] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => onPick(v)}
          className={cn(
            'min-h-[40px] rounded-[5px] px-4 text-[14px] font-medium transition',
            view === v ? 'bg-surface-elevated text-ink-strong shadow-xs' : 'text-ink-muted',
          )}
        >
          {v === 'day' ? 'Ditë' : 'Javë'}
        </button>
      ))}
    </div>
  );
}

// ── Day strip ────────────────────────────────────────────────────────────────

function DayStrip({
  selectedDay,
  onToday,
  onPrev,
  onNext,
  onJumpToday,
}: {
  selectedDay: string;
  onToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onJumpToday: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Dita e mëparshme"
        className="grid h-11 w-11 place-items-center rounded-full text-ink-muted transition active:bg-surface-muted [-webkit-tap-highlight-color:transparent]"
      >
        <NavIcon name="back" size={20} />
      </button>
      <div className="flex min-w-0 flex-col items-center">
        <span className="truncate text-[14px] font-semibold text-ink-strong">
          {formatLongAlbanianDate(selectedDay)}
        </span>
        {!onToday ? (
          <button
            type="button"
            onClick={onJumpToday}
            className="mt-0.5 rounded-pill bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-dark"
          >
            Shko te sot
          </button>
        ) : (
          <span className="mt-0.5 rounded-pill bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-ink-muted">
            Sot
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onNext}
        aria-label="Dita tjetër"
        className="grid h-11 w-11 place-items-center rounded-full text-ink-muted transition active:bg-surface-muted [-webkit-tap-highlight-color:transparent]"
      >
        <NavIcon name="chevright" size={20} />
      </button>
    </div>
  );
}

// ── Status filter pills (horizontal scroll on phone) ─────────────────────────

const FILTER_PILLS: {
  filter: StatusFilter;
  label: string;
  inactive: string;
  active: string;
  dot: string;
}[] = [
  {
    filter: 'all',
    label: 'Të gjitha',
    inactive: 'border-line-strong text-ink-muted',
    active: 'border-transparent bg-ink text-white',
    dot: 'bg-ink-muted',
  },
  {
    filter: 'scheduled',
    label: 'Planifikuar',
    inactive: 'border-status-scheduled-border bg-status-scheduled-bg text-status-scheduled-fg',
    active: 'border-transparent bg-status-scheduled-solid text-white',
    dot: 'bg-status-scheduled-solid',
  },
  {
    filter: 'completed',
    label: 'Kryer',
    inactive: 'border-status-completed-border bg-status-completed-bg text-status-completed-fg',
    active: 'border-transparent bg-status-completed-solid text-white',
    dot: 'bg-status-completed-solid',
  },
  {
    filter: 'no_show',
    label: 'Mungesë',
    inactive: 'border-status-no-show-border bg-status-no-show-bg text-status-no-show-fg',
    active: 'border-transparent bg-status-no-show-solid text-white',
    dot: 'bg-status-no-show-solid',
  },
];

function FilterPills({
  active,
  counts,
  onChange,
}: {
  active: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (f: StatusFilter) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Filtro sipas statusit"
      className="mt-3 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden"
    >
      {FILTER_PILLS.map((p) => {
        const isActive = active === p.filter;
        return (
          <button
            key={p.filter}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(p.filter)}
            className={cn(
              'inline-flex min-h-[36px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition',
              isActive ? p.active : p.inactive,
            )}
          >
            <span
              aria-hidden
              className={cn('h-[7px] w-[7px] rounded-full', isActive ? 'bg-white/85' : p.dot)}
            />
            {p.label}
            <span
              className={cn(
                'rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums',
                isActive ? 'bg-white/20 text-white' : 'bg-ink/[0.06] text-current',
              )}
            >
              {counts[p.filter]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Agenda row ───────────────────────────────────────────────────────────────

function AgendaRow({
  entry,
  locked,
  onTap,
}: {
  entry: CalendarEntry;
  locked: boolean;
  onTap: () => void;
}) {
  const time = toLocalParts(new Date(entryStartMs(entry))).time;
  const age = ageLabel(entry.patient.dateOfBirth);
  const isDone = entry.status === 'completed';
  const isMissed = entry.status === 'no_show';
  const isActive = entry.status === 'in_progress' || entry.status === 'arrived';
  return (
    <li>
      <button
        type="button"
        onClick={onTap}
        aria-label={`${entry.patient.firstName} ${entry.patient.lastName} · ${time}`}
        className="grid w-full min-h-[56px] grid-cols-[52px_10px_1fr_auto] items-center gap-2.5 border-b border-line-soft px-4 py-2.5 text-left transition last:border-b-0 active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]"
      >
        <span
          className={cn(
            'font-mono text-[13px] tabular-nums text-ink',
            isDone && 'text-ink-faint line-through decoration-1',
          )}
        >
          {time}
        </span>
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 rounded-full bg-line-strong',
            isDone && 'bg-status-completed-solid',
            isMissed && 'bg-status-no-show-solid',
            isActive && 'bg-status-in-progress-solid',
          )}
        />
        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium text-ink">
            {entry.patient.firstName} {entry.patient.lastName}
            {age ? <span className="ml-1.5 text-[12px] font-normal text-ink-faint">{age}</span> : null}
          </span>
          {entry.isNewPatient ? (
            <span className="text-[11.5px] font-medium text-primary-dark">Pacient i ri</span>
          ) : null}
        </span>
        <StatusChip status={entry.status} locked={locked} />
      </button>
    </li>
  );
}

function StatusChip({ status, locked }: { status: VisitStatus; locked?: boolean }) {
  const map: Record<VisitStatus, { label: string; cls: string }> = {
    scheduled: { label: 'Planifikuar', cls: 'bg-status-scheduled-bg text-status-scheduled-fg' },
    arrived: { label: 'Paraqitur', cls: 'bg-status-in-progress-bg text-status-in-progress-fg' },
    in_progress: { label: 'Në vizitë', cls: 'bg-status-in-progress-bg text-status-in-progress-fg' },
    completed: { label: 'Kryer', cls: 'bg-status-completed-bg text-status-completed-fg' },
    no_show: { label: 'Mungesë', cls: 'bg-status-no-show-bg text-status-no-show-fg' },
  };
  const s = map[status];
  return (
    <span className={cn('shrink-0 rounded-pill px-2 py-0.5 text-[11.5px] font-medium', s.cls)}>
      {s.label}
      {locked ? <span className="ml-1 opacity-60" aria-label="E mbyllur">·</span> : null}
    </span>
  );
}

// ── Walk-in band ─────────────────────────────────────────────────────────────

function WalkInBand({
  walkIns,
  locked,
  onTap,
}: {
  walkIns: CalendarEntry[];
  locked: (e: CalendarEntry) => boolean;
  onTap: (e: CalendarEntry) => void;
}) {
  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink-strong">Vizita pa termin sot</h2>
        <span className="text-[12px] text-ink-muted">
          <strong className="font-semibold text-ink">{walkIns.length}</strong> · pa orë në kalendar
        </span>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2">
        {walkIns.map((e) => {
          const age = ageLabel(e.patient.dateOfBirth);
          return (
            <li key={e.id} className="border-b border-line-soft last:border-b-0 sm:[&:nth-last-child(2)]:border-b-0 sm:odd:border-r sm:odd:border-line-soft">
              <button
                type="button"
                onClick={() => onTap(e)}
                className="flex min-h-[56px] w-full items-center justify-between gap-2 border-l-2 border-l-accent-400 px-4 py-2.5 text-left transition active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {e.patient.firstName} {e.patient.lastName}
                    {age ? <span className="ml-1.5 text-[12px] font-normal text-ink-faint">{age}</span> : null}
                  </span>
                  <span className="text-[11.5px] text-ink-muted">
                    {toLocalParts(new Date(entryStartMs(e))).time}
                  </span>
                </span>
                <StatusChip status={e.status} locked={locked(e)} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── Compact week grid (tablet) ───────────────────────────────────────────────

function WeekGrid({
  entries,
  settings,
  weekStart,
  todayIso,
  onPick,
}: {
  entries: CalendarEntry[];
  settings: ClinicSettings | null;
  weekStart: string;
  todayIso: string;
  onPick: (e: CalendarEntry) => void;
}) {
  const PX_PER_MIN = 0.7; // ~42px / hour — compact but legible at tablet width

  // Axis bounds from the clinic's open hours (min start, max end across the
  // visible open days); default 10:00–18:00.
  const { startMin, endMin } = useMemo(() => {
    let lo = 24 * 60;
    let hi = 0;
    if (settings) {
      for (const dow of VISIBLE_WEEKDAYS) {
        const d = settings.hours.days[dow];
        if (!d.open) continue;
        lo = Math.min(lo, hhmmToMin(d.start));
        hi = Math.max(hi, hhmmToMin(d.end));
      }
    }
    if (lo >= hi) {
      lo = 10 * 60;
      hi = 18 * 60;
    }
    return { startMin: lo, endMin: hi };
  }, [settings]);

  const totalMin = endMin - startMin;
  const bodyHeight = totalMin * PX_PER_MIN;
  const hourLines = useMemo(() => {
    const lines: number[] = [];
    for (let m = Math.ceil(startMin / 60) * 60; m <= endMin; m += 60) lines.push(m);
    return lines;
  }, [startMin, endMin]);

  const days = useMemo(
    () => VISIBLE_WEEKDAYS.map((dow, i) => ({ dow, date: addLocalDays(weekStart, i) })),
    [weekStart],
  );

  // Bucket entries by day (skip walk-ins without a scheduled time).
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const e of entries) {
      if (!e.scheduledFor) continue;
      const { date } = toLocalParts(new Date(e.scheduledFor));
      const arr = map.get(date) ?? [];
      arr.push(e);
      map.set(date, arr);
    }
    return map;
  }, [entries]);

  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
      <div
        className="grid border-b border-line"
        style={{ gridTemplateColumns: '44px repeat(6, 1fr)' }}
      >
        <div />
        {days.map((d) => {
          const isToday = d.date === todayIso;
          const dd = d.date.slice(8);
          return (
            <div
              key={d.date}
              className={cn(
                'border-l border-line py-2 text-center',
                isToday && 'bg-primary-tint',
              )}
            >
              <div
                className={cn(
                  'text-[11px] font-medium uppercase',
                  isToday ? 'text-primary-dark' : 'text-ink-muted',
                )}
              >
                {WEEKDAY_SHORT[d.dow]}
              </div>
              <div
                className={cn(
                  'text-[13px] font-semibold tabular-nums',
                  isToday ? 'text-primary-dark' : 'text-ink',
                )}
              >
                {dd}
              </div>
            </div>
          );
        })}
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: '44px repeat(6, 1fr)', height: bodyHeight }}
      >
        {/* time axis */}
        <div className="relative">
          {hourLines.map((m) => (
            <div
              key={m}
              className="absolute right-1.5 -translate-y-1/2 font-mono text-[10px] tabular-nums text-ink-faint"
              style={{ top: (m - startMin) * PX_PER_MIN }}
            >
              {minToHhmm(m)}
            </div>
          ))}
        </div>
        {days.map((d) => {
          const dayEntries = byDay.get(d.date) ?? [];
          const isToday = d.date === todayIso;
          return (
            <div
              key={d.date}
              className={cn('relative border-l border-line', isToday && 'bg-primary-tint/40')}
            >
              {hourLines.map((m) => (
                <div
                  key={m}
                  className="absolute inset-x-0 border-t border-line-soft"
                  style={{ top: (m - startMin) * PX_PER_MIN }}
                  aria-hidden
                />
              ))}
              {dayEntries.map((e) => {
                const startParts = toLocalParts(new Date(e.scheduledFor!));
                const sMin = hhmmToMin(startParts.time);
                const dur = e.durationMinutes ?? 15;
                const top = (sMin - startMin) * PX_PER_MIN;
                const height = Math.max(13, dur * PX_PER_MIN - 2);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onPick(e)}
                    title={`${e.patient.firstName} ${e.patient.lastName} · ${startParts.time}`}
                    className={cn(
                      'absolute inset-x-0.5 overflow-hidden rounded-[4px] border px-1 py-0.5 text-left text-[10px] leading-tight',
                      weekBlockClass(e.status),
                    )}
                    style={{ top, height }}
                  >
                    <span className="block truncate font-medium">
                      {e.patient.firstName} {e.patient.lastName}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function weekBlockClass(status: VisitStatus): string {
  switch (status) {
    case 'completed':
      return 'border-status-completed-border bg-status-completed-bg text-status-completed-fg';
    case 'no_show':
      return 'border-status-no-show-border bg-status-no-show-bg text-status-no-show-fg';
    case 'in_progress':
    case 'arrived':
      return 'border-status-in-progress-border bg-status-in-progress-bg text-status-in-progress-fg';
    default:
      return 'border-status-scheduled-border bg-status-scheduled-bg text-status-scheduled-fg';
  }
}

// ── Status-change bottom sheet ───────────────────────────────────────────────

function StatusActionSheet({
  entry,
  locked,
  onClose,
  onChange,
}: {
  entry: CalendarEntry | null;
  locked: boolean;
  onClose: () => void;
  onChange: (entry: CalendarEntry, next: VisitStatus) => void;
}) {
  const open = entry != null;
  const targets = entry ? ALLOWED_TRANSITIONS[entry.status] : [];
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={entry ? `${entry.patient.firstName} ${entry.patient.lastName}` : 'Termini'}
      data-testid="reception-status-sheet"
    >
      <div className="px-[var(--m-gutter)] pb-4">
        {locked ? (
          <div className="rounded-md border border-line bg-surface-subtle px-3 py-3 text-[13px] text-ink-muted">
            Vizita është e mbyllur. Mjeku duhet të shënojë statusin.
          </div>
        ) : targets.length === 0 ? (
          <div className="px-1 py-2 text-[13px] text-ink-muted">
            Asnjë veprim i mundshëm për këtë status.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {targets.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => entry && onChange(entry, t)}
                  className="flex min-h-[52px] w-full items-center gap-3 rounded-md border border-line-strong bg-surface-elevated px-4 text-left text-[15px] font-medium text-ink transition active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]"
                >
                  Shëno si {STATUS_ACTION_LABEL[t]}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </BottomSheet>
  );
}

// ── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDone, 3200);
    return () => window.clearTimeout(id);
  }, [onDone]);
  return (
    <div
      role="status"
      className="fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: 'calc(var(--m-tabbar-h) + env(safe-area-inset-bottom, 0px) + 12px)' }}
    >
      <div className="max-w-sm rounded-lg bg-ink px-4 py-2.5 text-[13px] font-medium text-white shadow-lg">
        {message}
      </div>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Anchoring instant for an entry: scheduled time, else arrival/creation. */
function entryStartMs(e: CalendarEntry): number {
  const iso = e.scheduledFor ?? e.arrivedAt ?? e.createdAt;
  return new Date(iso).getTime();
}

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
function minToHhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function relativeLabel(target: Date, now: Date): string {
  const diffMin = Math.round((target.getTime() - now.getTime()) / 60_000);
  if (diffMin <= 0) return 'tani';
  if (diffMin < 60) return `pas ${diffMin} ${diffMin === 1 ? 'minute' : 'minutash'}`;
  const hours = Math.round(diffMin / 60);
  return `pas ${hours} ${hours === 1 ? 'ore' : 'orësh'}`;
}
