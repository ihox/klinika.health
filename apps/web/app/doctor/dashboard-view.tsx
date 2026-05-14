'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import { ClinicTopNav } from '@/components/clinic-top-nav';
import { Skeleton } from '@/components/skeleton';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';
import {
  formatLongAlbanianDate,
  toLocalParts,
} from '@/lib/appointment-client';
import {
  daysSinceColor,
  doctorDashboardClient,
  formatEuros,
  greetingForInstant,
  type DashboardAppointment,
  type DashboardNextPatientCard,
  type DashboardVisitLogEntry,
  type DoctorDashboardResponse,
} from '@/lib/doctor-dashboard-client';
import { ageLabel, type PatientPublicDto } from '@/lib/patient-client';
import { cn } from '@/lib/utils';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * "Pamja e ditës" — the doctor's first screen of the day.
 *
 * Auto-refreshes the entire snapshot every 60s (per the prototype's
 * "I përditësuar para Xs" pill) and on tab focus. The receptionist
 * calendar already broadcasts SSE for appointment changes; the
 * doctor's dashboard piggy-backs on the same stream so that a
 * receptionist marking a patient as `completed` flips the
 * appointment row here in near-real-time.
 */
export function DashboardView(): ReactElement {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<DoctorDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [lastRefreshAt, setLastRefreshAt] = useState<Date>(() => new Date());

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await doctorDashboardClient.get();
      setSnapshot(res);
      setLastRefreshAt(new Date());
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.href = '/login?reason=session-expired';
        return;
      }
      setError('Nuk u ngarkua paneli i ditës.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Polling every 60s — the prototype's quoted refresh cadence.
  useEffect(() => {
    const id = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // Tick a "now" once a minute so the "I përditësuar para …" pill,
  // the current-appointment highlight, and the next-patient countdown
  // stay accurate without re-fetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Tab focus → invalidate; mirrors the receptionist calendar.
  useEffect(() => {
    function onVis(): void {
      if (document.visibilityState === 'visible') {
        void load();
      }
    }
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  // Real-time freshness: SSE from the appointments module fires when
  // the receptionist changes a status (or another doctor's visit save
  // flips a row to completed). We don't filter event types here —
  // every event is cheap to reload from a single dashboard endpoint.
  useEffect(() => {
    const url = `/api/appointments/stream`;
    const source = new EventSource(url, { withCredentials: true });
    const onEvent = (): void => void load();
    source.addEventListener('appointment.created', onEvent);
    source.addEventListener('appointment.updated', onEvent);
    source.addEventListener('appointment.deleted', onEvent);
    source.onerror = () => {
      // Browser auto-reconnects; we keep polling as fallback.
    };
    return () => source.close();
  }, [load]);

  const greeting = useMemo(() => greetingForInstant(now), [now]);
  const todayLabel = useMemo(
    () => formatLongAlbanianDate(snapshot?.date ?? toLocalParts(now).date),
    [snapshot?.date, now],
  );

  const openPatientChart = useCallback(
    (patientId: string) => {
      router.push(`/doctor/pacientet?patientId=${patientId}`);
    },
    [router],
  );

  const openVisitChart = useCallback(
    (entry: DashboardVisitLogEntry) => {
      router.push(`/doctor/pacientet?patientId=${entry.patientId}`);
    },
    [router],
  );

  return (
    <main className="min-h-screen bg-surface pb-12">
      <DashboardTopBar />

      <div className="mx-auto max-w-page px-page-x pt-6">
        <GreetingStrip
          greeting={greeting}
          dateLabel={todayLabel}
          completedCount={snapshot?.stats.visitsCompleted ?? 0}
          remainingCount={Math.max(
            0,
            (snapshot?.stats.appointmentsTotal ?? 0) -
              (snapshot?.stats.appointmentsCompleted ?? 0),
          )}
          lastRefreshAt={lastRefreshAt}
          now={now}
        />

        {error ? (
          <div
            role="status"
            className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900"
          >
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-[40fr_60fr] gap-5">
          {/* LEFT COLUMN */}
          <div className="flex flex-col gap-5">
            <AppointmentsPanel
              snapshot={snapshot}
              now={now}
              onAppointmentClick={(a) => openPatientChart(a.patientId)}
            />
          </div>

          {/* RIGHT COLUMN */}
          <div className="flex flex-col gap-5">
            <NextPatientCard
              card={snapshot?.nextPatient ?? null}
              now={now}
              onOpenChart={openPatientChart}
            />
            <VisitsLogPanel
              entries={snapshot?.todayVisits ?? []}
              onEntryClick={openVisitChart}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

// =========================================================================
// Top bar
// =========================================================================

function DashboardTopBar(): ReactElement {
  // Role-filtered top nav (ADR-004). A user who lands here while still
  // loading `/me` sees the brand chrome but no menu items — the nav
  // re-renders the moment roles arrive. Avoids the menu briefly
  // showing the wrong items.
  const { me } = useMe();
  return <ClinicTopNav roles={me?.roles ?? []} />;
}

// =========================================================================
// Greeting strip
// =========================================================================

interface GreetingStripProps {
  greeting: string;
  dateLabel: string;
  completedCount: number;
  remainingCount: number;
  lastRefreshAt: Date;
  now: Date;
}

function GreetingStrip({
  greeting,
  dateLabel,
  completedCount,
  remainingCount,
  lastRefreshAt,
  now,
}: GreetingStripProps): ReactElement {
  const secondsAgo = Math.max(
    0,
    Math.floor((now.getTime() - lastRefreshAt.getTime()) / 1000),
  );
  const summary =
    completedCount === 0 && remainingCount === 0
      ? null
      : `${completedCount} ${completedCount === 1 ? 'vizitë e kryer' : 'vizita të kryera'} · ${remainingCount} ${remainingCount === 1 ? 'e mbetur' : 'të mbetura'}`;
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.025em] text-ink-strong">
          {greeting},{' '}
          <span className="text-primary-dark">Dr. Taulant Shala</span>.
        </h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          {dateLabel}
          {summary ? ` · ${summary}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        I përditësuar para {formatSecondsAgo(secondsAgo)}
      </div>
    </div>
  );
}

function formatSecondsAgo(seconds: number): string {
  if (seconds < 5) return 'pak çastesh';
  if (seconds < 60) return `${seconds} sekondash`;
  const minutes = Math.floor(seconds / 60);
  if (minutes === 1) return '1 minute';
  return `${minutes} minutash`;
}

// =========================================================================
// Appointments panel + quick search + stats
// =========================================================================

interface AppointmentsPanelProps {
  snapshot: DoctorDashboardResponse | null;
  now: Date;
  onAppointmentClick: (a: DashboardAppointment) => void;
}

function AppointmentsPanel({
  snapshot,
  now,
  onAppointmentClick,
}: AppointmentsPanelProps): ReactElement {
  const [filter, setFilter] = useState('');
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // `/` or ⌘/Ctrl+K focuses the quick filter — same shortcut the
  // receptionist's global search uses.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (isEditableTarget(e.target)) return;
      if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!snapshot) return [];
    if (q.length === 0) return snapshot.appointments;
    return snapshot.appointments.filter((a) => {
      const name = `${a.patient.firstName} ${a.patient.lastName}`.toLowerCase();
      return name.includes(q);
    });
  }, [filter, snapshot]);

  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-[-0.005em] text-ink-strong">
          Terminet e sotit
        </h2>
        <span className="text-[12px] text-ink-muted">
          {snapshot
            ? `${snapshot.stats.appointmentsTotal} gjithsej · ${snapshot.stats.appointmentsCompleted} të kryera`
            : '—'}
        </span>
      </div>

      <div className="px-4 py-3">
        <label className="relative block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
            <SearchIcon />
          </span>
          <input
            ref={filterInputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Kërko pacient ose diagnozë... ( / )"
            aria-label="Kërko në terminet e sotit"
            className="h-9 w-full rounded-md border border-line-strong bg-surface-elevated pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
          />
        </label>
      </div>

      <div className="flex flex-col">
        {snapshot == null ? (
          <AppointmentListSkeleton />
        ) : filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-ink-muted">
            {filter.trim()
              ? 'Asnjë termin nuk përputhet me kërkimin.'
              : 'Asnjë termin i caktuar.'}
          </div>
        ) : (
          filtered.map((a) => (
            <AppointmentRow
              key={a.id}
              appointment={a}
              now={now}
              onClick={() => onAppointmentClick(a)}
            />
          ))
        )}
      </div>

      <DayStats snapshot={snapshot} />
    </section>
  );
}

function AppointmentListSkeleton(): ReactElement {
  // Mirrors AppointmentRow's grid (time / spacer / name / badge) so the
  // swap-in is jump-free per the loading-skeletons reference.
  const nameWidths = ['72%', '58%', '80%', '64%', '70%'];
  return (
    <div className="flex flex-col" aria-label="Po ngarkohet…" role="status">
      {nameWidths.map((w, i) => (
        <div
          key={i}
          className="grid w-full grid-cols-[58px_12px_1fr_auto] items-center gap-2.5 border-b border-line-soft px-4 py-3 last:border-b-0"
        >
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-3" />
          <Skeleton className="h-3" style={{ width: w }} />
          <Skeleton className="h-[18px] w-12 rounded-pill" />
        </div>
      ))}
    </div>
  );
}

interface AppointmentRowProps {
  appointment: DashboardAppointment;
  now: Date;
  onClick: () => void;
}

function AppointmentRow({
  appointment: a,
  now,
  onClick,
}: AppointmentRowProps): ReactElement {
  const isCurrent = a.position === 'current';
  const isNext = a.position === 'next';
  const isPast = a.position === 'past';
  const isDone = a.status === 'completed';
  const isMissed = a.status === 'no_show';
  const time = toLocalParts(new Date(a.scheduledFor)).time;
  const ageStr = ageLabel(a.patient.dateOfBirth);
  const minutesUntil = Math.round(
    (new Date(a.scheduledFor).getTime() - now.getTime()) / 60_000,
  );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isCurrent || isNext ? 'true' : undefined}
      className={cn(
        'grid w-full grid-cols-[58px_12px_1fr_auto] items-center gap-2.5 border-b border-line-soft px-4 py-2.5 text-left transition last:border-b-0 hover:bg-surface-subtle',
        (isCurrent || isNext) &&
          'border-l-2 border-l-primary bg-gradient-to-r from-primary-tint to-transparent pl-[14px]',
      )}
    >
      <span
        className={cn(
          'font-medium tabular-nums text-[13px] text-ink',
          isPast && isDone && 'text-ink-faint line-through decoration-1',
        )}
      >
        {time}
      </span>
      <span
        className={cn(
          'h-2 w-2 rounded-full bg-line-strong',
          isDone && 'bg-success',
          isMissed && 'bg-danger',
          (isCurrent || isNext) && 'bg-primary ring-4 ring-primary-soft',
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <div
          className={cn(
            'truncate text-[13px] font-medium text-ink',
            (isCurrent || isNext) && 'font-semibold text-ink-strong',
            isPast && isDone && 'text-ink-muted',
          )}
        >
          {a.patient.firstName} {a.patient.lastName}
          {ageStr ? (
            <span className="ml-1.5 text-[12px] font-normal text-ink-faint">
              {ageStr}
            </span>
          ) : null}
        </div>
        <div className="truncate text-[11px] text-ink-muted">
          {isMissed
            ? 'Mungesë'
            : isCurrent
              ? 'Po vazhdon tani'
              : isNext
                ? minutesUntil <= 0
                  ? 'Tani'
                  : `Pas ${minutesUntil} ${minutesUntil === 1 ? 'minute' : 'minutash'}`
                : statusToReason(a.status, a.durationMinutes)}
        </div>
      </div>
      <span
        className={cn(
          'rounded-md border border-line bg-surface-subtle px-2 py-0.5 text-[11px] font-mono text-ink-muted',
          isCurrent && 'border-primary/40 bg-primary-soft text-primary-dark',
          isMissed && 'border-danger/30 bg-danger/10 text-danger',
        )}
      >
        {isCurrent ? 'Tani' : isMissed ? 'MS' : `${a.durationMinutes} min`}
      </span>
    </button>
  );
}

function statusToReason(
  status: DashboardAppointment['status'],
  durationMinutes: number,
): string {
  switch (status) {
    case 'completed':
      return 'E kryer';
    case 'cancelled':
      return 'E anuluar';
    case 'no_show':
      return 'Mungesë';
    default:
      return `${durationMinutes} min · në pritje`;
  }
}

// =========================================================================
// Day stats (the strip at the bottom of the left column)
// =========================================================================

function DayStats({
  snapshot,
}: {
  snapshot: DoctorDashboardResponse | null;
}): ReactElement {
  const completed = snapshot?.stats.visitsCompleted ?? 0;
  const total = snapshot?.stats.appointmentsTotal ?? 0;
  const avg = snapshot?.stats.averageVisitMinutes;
  const payments = snapshot?.stats.paymentsCents ?? 0;
  return (
    <div className="grid grid-cols-3 border-t border-line">
      <Stat
        value={
          total > 0
            ? `${completed} / ${total}`
            : completed.toString()
        }
        label="Vizita"
      />
      <Stat
        value={
          avg == null ? (
            '—'
          ) : (
            <>
              {avg.toFixed(avg < 10 ? 1 : 0)}
              <span className="ml-1 text-[12px] tracking-normal text-ink-faint">
                min
              </span>
            </>
          )
        }
        label="Mesatare"
      />
      <Stat value={formatEuros(payments)} label="Pagesa" />
    </div>
  );
}

function Stat({
  value,
  label,
}: {
  value: ReactElement | string;
  label: string;
}): ReactElement {
  return (
    <div className="border-r border-line px-4 py-3.5 last:border-r-0">
      <div className="font-display text-[22px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-[11px] uppercase tracking-[0.06em] text-ink-muted">
        {label}
      </div>
    </div>
  );
}

// =========================================================================
// Next patient card
// =========================================================================

interface NextPatientCardProps {
  card: DashboardNextPatientCard | null;
  now: Date;
  onOpenChart: (patientId: string) => void;
}

function NextPatientCard({
  card,
  now,
  onOpenChart,
}: NextPatientCardProps): ReactElement {
  if (!card) {
    return (
      <div className="rounded-lg border border-line bg-surface-elevated px-6 py-8 shadow-xs">
        <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-primary-dark">
          Pacienti në vijim
        </div>
        <div className="mt-3 font-display text-[22px] font-semibold text-ink-muted">
          Nuk ka pacient tjetër sot.
        </div>
      </div>
    );
  }

  const start = new Date(card.scheduledFor);
  const minutesUntil = Math.round((start.getTime() - now.getTime()) / 60_000);
  const time = toLocalParts(start).time;
  const weekdayShort = (
    ({ mon: 'Hën', tue: 'Mar', wed: 'Mër', thu: 'Enj', fri: 'Pre', sat: 'Sht', sun: 'Die' }) as Record<
      string,
      string
    >
  )[toLocalParts(start).weekday] ?? '';
  const ageStr = ageLabel(card.patient.dateOfBirth);
  const sexStr = card.patient.sex === 'm' ? 'djalë' : card.patient.sex === 'f' ? 'vajzë' : null;
  const visitCountStr =
    card.visitCount === 0
      ? 'Pacient i ri'
      : card.visitCount === 1
        ? '1 vizitë'
        : `${card.visitCount} vizita`;
  const sinceLabel =
    card.daysSinceLastVisit == null
      ? null
      : card.daysSinceLastVisit === 0
        ? 'sot'
        : card.daysSinceLastVisit === 1
          ? 'dje'
          : `${card.daysSinceLastVisit} ditë nga vizita e fundit`;
  const sinceColor = daysSinceColor(card.daysSinceLastVisit);

  return (
    <section
      className="rounded-lg border border-line bg-surface-elevated px-6 py-5 shadow-xs"
      style={{
        background:
          'radial-gradient(ellipse 60% 60% at 100% 0%, var(--tw-color-primary-tint, #F0FDFA), transparent 50%), #FFFFFF',
      }}
    >
      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-primary-dark">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
        {minutesUntil <= 0
          ? 'Pacienti në vijim · tani'
          : `Pacienti në vijim · pas ${minutesUntil} ${minutesUntil === 1 ? 'minute' : 'minutash'}`}
      </div>

      <div className="mt-2 grid grid-cols-[1fr_auto] items-start gap-5">
        <div className="min-w-0">
          <div className="font-display text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] text-ink-strong">
            {card.patient.firstName} {card.patient.lastName}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink-muted">
            <span>
              <strong className="font-semibold text-ink">{ageStr}</strong>
              {sexStr ? ` · ${sexStr}` : ''}
            </span>
            <span>{visitCountStr}</span>
            {sinceLabel ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-[11.5px]',
                  sinceColor === 'green' && 'border-success-soft bg-success-bg text-success',
                  sinceColor === 'yellow' && 'border-warning-soft bg-warning-bg text-warning',
                  sinceColor === 'red' && 'border-danger-soft bg-danger-bg text-danger',
                  sinceColor === 'neutral' && 'border-line bg-surface-subtle text-ink-muted',
                )}
              >
                <span
                  className={cn(
                    'h-1.5 w-1.5 rounded-full',
                    sinceColor === 'green' && 'bg-success',
                    sinceColor === 'yellow' && 'bg-warning',
                    sinceColor === 'red' && 'bg-danger',
                    sinceColor === 'neutral' && 'bg-ink-faint',
                  )}
                />
                {sinceLabel}
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-right tabular-nums">
          <div className="font-display text-[28px] font-semibold tracking-tight">
            {time}
          </div>
          <div className="mt-1 text-[12px] text-ink-muted">
            {weekdayShort} · {card.durationMinutes} min
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-3 border-t border-line pt-4">
        <Tile label="Diagnoza e fundit">
          {card.lastDiagnosis ? (
            <>
              <div className="text-[14px] font-semibold text-ink-strong">
                {card.lastDiagnosis.latinDescription}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-muted">
                {card.lastDiagnosis.code}
                {card.lastVisitDate ? ` · ${formatShortDob(card.lastVisitDate)}` : ''}
              </div>
            </>
          ) : (
            <span className="text-[13px] text-ink-muted">—</span>
          )}
        </Tile>
        <Tile label="Pesha">
          {card.lastWeightG != null ? (
            <>
              <div className="font-display text-[18px] font-semibold tabular-nums text-ink-strong">
                {(card.lastWeightG / 1000).toFixed(1)}
                <span className="ml-1 text-[12px] tracking-normal text-ink-faint">
                  kg
                </span>
              </div>
            </>
          ) : (
            <span className="text-[13px] text-ink-muted">—</span>
          )}
        </Tile>
        <Tile label="Alergji / Tjera">
          {card.hasAllergyNote ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-warning-soft bg-warning-bg px-2 py-0.5 text-[12px] font-medium text-warning">
              <span aria-hidden>⚠</span>
              Shih kartelën
            </span>
          ) : (
            <span className="text-[13px] text-ink-muted">Pa shënime</span>
          )}
        </Tile>
        <Tile label="Vizita">
          <div className="font-display text-[18px] font-semibold tabular-nums text-ink-strong">
            {card.visitCount}
          </div>
        </Tile>
      </div>

      <div className="mt-4 flex gap-2.5">
        <Button onClick={() => onOpenChart(card.patientId)}>
          Hap kartelën →
        </Button>
        <Button
          variant="secondary"
          onClick={() => onOpenChart(card.patientId)}
        >
          Shiko historinë
        </Button>
      </div>
    </section>
  );
}

function Tile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function formatShortDob(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

// =========================================================================
// Today's visit log (bottom right)
// =========================================================================

interface VisitsLogPanelProps {
  entries: DashboardVisitLogEntry[];
  onEntryClick: (entry: DashboardVisitLogEntry) => void;
}

function VisitsLogPanel({
  entries,
  onEntryClick,
}: VisitsLogPanelProps): ReactElement {
  return (
    <section className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-[13px] font-semibold text-ink-strong">
          Vizitat e sotshme
        </h2>
        <span className="text-[12px] text-ink-muted">
          {entries.length === 1
            ? '1 e regjistruar'
            : `${entries.length} të regjistruara`}
        </span>
      </div>
      <div>
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-ink-muted">
            Asnjë vizitë e regjistruar sot.
          </div>
        ) : (
          entries.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => onEntryClick(e)}
              className="grid w-full grid-cols-[60px_1fr_auto_auto] items-center gap-4 border-b border-line-soft px-4 py-2.5 text-left text-[13px] transition last:border-b-0 hover:bg-surface-subtle"
            >
              <span className="font-mono text-[12px] tabular-nums text-ink-muted">
                {toLocalParts(new Date(e.recordedAt)).time}
              </span>
              <span className="min-w-0 truncate font-medium text-ink">
                {e.patient.firstName} {e.patient.lastName}
                {e.patient.dateOfBirth ? (
                  <span className="ml-1.5 text-[11px] font-normal text-ink-faint">
                    {ageLabel(e.patient.dateOfBirth)}
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-[11px] text-ink-muted bg-surface-subtle border border-line rounded px-1.5 py-0.5">
                {e.primaryDiagnosis
                  ? `${e.primaryDiagnosis.code} ${e.primaryDiagnosis.latinDescription}`
                  : 'Pa diagnozë'}
              </span>
              <span className="font-display text-[13px] font-semibold tabular-nums text-ink">
                {e.paymentCode ? (
                  <>
                    <span className="mr-1 text-[11px] font-normal text-ink-faint">
                      {e.paymentCode}
                    </span>
                    {e.paymentAmountCents != null
                      ? formatEuros(e.paymentAmountCents)
                      : '—'}
                  </>
                ) : (
                  '—'
                )}
              </span>
            </button>
          ))
        )}
      </div>
    </section>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function SearchIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <circle cx="7" cy="7" r="5" />
      <path d="M11 11l3 3" strokeLinecap="round" />
    </svg>
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

// Avoid `PatientPublicDto` unused-import lint until we wire the global
// search (slice 11). Re-export keeps the import meaningful.
export type { PatientPublicDto };
