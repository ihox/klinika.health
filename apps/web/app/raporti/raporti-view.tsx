'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { ClinicTopNav } from '@/components/clinic-top-nav';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { formatLongAlbanianDate, todayIsoLocal } from '@/lib/appointment-client';
import {
  dailyReportClient,
  type DailyReportResponse,
  type DailyReportStatus,
  type DailyReportVisit,
} from '@/lib/daily-report-client';
import type { AuthRole } from '@/lib/auth-client';
import { ageLabel } from '@/lib/patient-client';
import { useMe } from '@/lib/use-me';
import { cn } from '@/lib/utils';
import {
  buildGreeting,
  centsToEur,
  chipLabel,
  countPaid,
  formatCompactSq,
  formatDl,
  isReceptionistOnlyRoles,
  primaryRoleFor,
  stepDay,
  sumCents,
} from './raporti-utils';

type FilterKey = 'all' | 'completed' | 'no_show' | 'scheduled';

interface FilterDef {
  key: FilterKey;
  label: string;
  /** Status values this filter matches; omitted for `all`. */
  match?: DailyReportStatus[];
}

const FILTERS: FilterDef[] = [
  { key: 'all', label: 'Të gjitha' },
  { key: 'completed', label: 'Të përfunduara', match: ['completed'] },
  { key: 'no_show', label: 'Mungesa', match: ['no_show'] },
  { key: 'scheduled', label: 'Të planifikuara', match: ['scheduled', 'arrived', 'in_progress'] },
];

/**
 * Status colors used in the horizontal stacked bar + per-row chips.
 * Pull from the prototype's print swatches so the screen and print
 * read the same.
 */
const STATUS_SOLID: Record<DailyReportStatus, string> = {
  scheduled: '#4F46E5',
  arrived: '#0E7490',
  in_progress: '#0E7490',
  completed: '#15803D',
  no_show: '#B45309',
};

export function RaportiView() {
  const { me } = useMe();
  const today = todayIsoLocal();
  const [date, setDate] = useState<string>(today);
  const [data, setData] = useState<DailyReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [restricted, setRestricted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  const receptionistOnly = useMemo(
    () => isReceptionistOnlyRoles((me?.roles ?? []) as AuthRole[]),
    [me?.roles],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRestricted(false);
    setError(null);
    dailyReportClient
      .get(date)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 403 && err.body.reason === 'date_out_of_range') {
          setRestricted(true);
          setData(null);
          return;
        }
        setError('Nuk u ngarkua raporti.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const visits: DailyReportVisit[] = useMemo(
    () => data?.visits ?? [],
    [data?.visits],
  );
  const filtered = useMemo(() => {
    if (filter === 'all') return visits;
    const def = FILTERS.find((f) => f.key === filter);
    if (!def?.match) return visits;
    return visits.filter((v) => def.match!.includes(v.status));
  }, [visits, filter]);

  const filteredSumCents = useMemo(() => sumCents(filtered), [filtered]);

  const counts: Record<FilterKey, number> = useMemo(() => {
    const acc: Record<FilterKey, number> = {
      all: visits.length,
      completed: 0,
      no_show: 0,
      scheduled: 0,
    };
    for (const v of visits) {
      if (v.status === 'completed') acc.completed += 1;
      else if (v.status === 'no_show') acc.no_show += 1;
      else acc.scheduled += 1;
    }
    return acc;
  }, [visits]);

  function gotoPrev() {
    setDate((d) => stepDay(d, -1));
  }
  function gotoNext() {
    setDate((d) => stepDay(d, 1));
  }
  function gotoToday() {
    setDate(today);
  }

  const yesterday = stepDay(today, -1);
  const prevDisabled = receptionistOnly && date <= yesterday;
  const nextDisabled = receptionistOnly && date >= today;
  const isToday = date === today;
  const isFuture = date > today;

  const role = primaryRoleFor(me?.roles ?? []);
  const greeting = useMemo(() => buildGreeting(me?.firstName ?? ''), [me?.firstName]);

  function openPrint() {
    if (typeof window === 'undefined') return;
    window.open(`/raporti/print?date=${encodeURIComponent(date)}`, '_blank');
  }

  return (
    <>
      <ClinicTopNav me={me} />
      <main className="mx-auto max-w-page px-page-x py-page-y">
        {/* Header */}
        <div className="mb-[22px] flex items-end justify-between gap-6">
          <div>
            <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
              Raporti
              {role ? <span className="ml-2 rounded-full border border-line bg-surface-subtle px-[7px] py-[1px] text-[9.5px] tracking-[0.04em] text-ink-muted">{role}</span> : null}
            </div>
            <h1 className="font-display text-[26px] font-semibold leading-[1.05] tracking-[-0.025em] text-ink-strong">
              {greeting}
            </h1>
            <div className="mt-1 text-[13px] text-ink-muted">
              Raporti i ditës · {formatLongAlbanianDate(date)}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <DateNav
              date={date}
              isToday={isToday}
              isFuture={isFuture}
              prevDisabled={prevDisabled}
              nextDisabled={nextDisabled}
              pickerEnabled={!receptionistOnly}
              onPrev={gotoPrev}
              onNext={gotoNext}
              onToday={gotoToday}
              onPick={setDate}
            />
            <Button variant="secondary" size="sm" onClick={openPrint} disabled={!data}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="mr-1.5">
                <path d="M4 4V2h8v2M4 12H2V6h12v6h-2M4 9h8v5H4z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Printo
            </Button>
          </div>
        </div>

        {restricted ? (
          <RestrictedBanner />
        ) : error ? (
          <div className="mb-4 rounded-lg border border-line bg-surface-elevated p-4 text-[13px] text-ink-muted">
            {error}
          </div>
        ) : null}

        {/* Three tiles — Direction A */}
        <div className="mb-[22px] grid grid-cols-1 gap-4 md:grid-cols-[1.05fr_1fr_1.4fr]">
          <RevenueTile
            totalCents={data?.totalRevenueCents ?? 0}
            breakdown={data?.paymentCodeBreakdown ?? []}
            loading={loading}
          />
          <CountTile
            visitCount={data?.visitCount ?? 0}
            paidCount={data?.paidCount ?? 0}
            loading={loading}
          />
          <StatusTile
            breakdown={data?.statusBreakdown}
            loading={loading}
          />
        </div>

        {/* Filter pills */}
        <div className="mb-3.5 flex flex-wrap items-center gap-3">
          <span className="mr-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
            Filtrim
          </span>
          {FILTERS.map((f) => (
            <FilterPill
              key={f.key}
              active={filter === f.key}
              label={f.label}
              count={counts[f.key]}
              onClick={() => setFilter(f.key)}
            />
          ))}
          <div className="flex-1" />
          <div className="font-mono text-[12px] tabular-nums text-ink-muted">
            <strong className="font-semibold text-ink">{filtered.length}</strong> nga{' '}
            {visits.length} {visits.length === 1 ? 'vizitë' : 'vizita'}
          </div>
        </div>

        {/* Visits table */}
        <div className="overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
          {loading ? (
            <div className="px-6 py-12 text-center text-[13px] text-ink-muted">Po ngarkohet…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              filter={filter}
              hasAnyVisits={visits.length > 0}
              restricted={restricted}
            />
          ) : (
            <VisitsTable
              visits={filtered}
              totalCents={filteredSumCents}
              paidCount={countPaid(filtered)}
              otherCount={filtered.length - countPaid(filtered)}
            />
          )}
        </div>
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface DateNavProps {
  date: string;
  isToday: boolean;
  isFuture: boolean;
  prevDisabled: boolean;
  nextDisabled: boolean;
  /**
   * When true, clicking the date display opens the browser's native
   * calendar picker (same affordance as vërtetim). False for
   * receptionist-only sessions, which keep the arrow-only nav per
   * the original design.
   */
  pickerEnabled: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPick: (date: string) => void;
}

function DateNav(props: DateNavProps) {
  const compact = formatCompactSq(props.date);
  const pickerRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    // `showPicker` is the canonical "open this input's picker" API
    // (Chromium, Safari 16.4+, Firefox 101+). Fall back to focus on
    // the rare browser that doesn't expose it — Chromium then opens
    // the picker on the next click anyway.
    if (typeof el.showPicker === 'function') {
      try {
        el.showPicker();
        return;
      } catch {
        // showPicker can throw if the input isn't user-focusable yet;
        // fall through to focus.
      }
    }
    el.focus();
    el.click();
  }

  return (
    <div className="relative flex items-center gap-1 rounded-lg border border-line bg-surface-elevated p-[3px] shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <button
        type="button"
        onClick={props.onPrev}
        disabled={props.prevDisabled}
        aria-label="Dita e mëparshme"
        className={cn(
          'grid h-8 w-8 place-items-center rounded text-ink-muted transition-colors',
          props.prevDisabled
            ? 'cursor-not-allowed opacity-45'
            : 'hover:bg-surface-subtle hover:text-ink',
        )}
      >
        <ChevronIcon dir="left" />
      </button>
      {props.pickerEnabled ? (
        <button
          type="button"
          onClick={openPicker}
          aria-label="Zgjidh datën"
          className="relative flex h-8 min-w-[168px] items-center justify-center rounded px-3.5 font-display text-[14px] font-semibold tracking-[-0.005em] tabular-nums hover:bg-surface-subtle"
        >
          <CalendarIcon className="mr-1.5 text-ink-faint" />
          {compact}
          {/* Native date input — visually hidden but still focusable
              so `showPicker()` anchors the calendar popover to the
              date pill. We position it over the pill (not off-screen)
              so browsers that don't support showPicker still align
              the popover correctly when the input is focused. */}
          <input
            ref={pickerRef}
            type="date"
            value={props.date}
            onChange={(e) => {
              const v = e.target.value;
              if (v) props.onPick(v);
            }}
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </button>
      ) : (
        <div
          className="flex h-8 min-w-[168px] items-center justify-center rounded px-3.5 font-display text-[14px] font-semibold tracking-[-0.005em] tabular-nums"
          aria-label="Data e raportit"
        >
          <CalendarIcon className="mr-1.5 text-ink-faint" />
          {compact}
        </div>
      )}
      <button
        type="button"
        onClick={props.onNext}
        disabled={props.nextDisabled}
        aria-label="Dita e ardhshme"
        className={cn(
          'grid h-8 w-8 place-items-center rounded text-ink-muted transition-colors',
          props.nextDisabled
            ? 'cursor-not-allowed opacity-45'
            : 'hover:bg-surface-subtle hover:text-ink',
        )}
      >
        <ChevronIcon dir="right" />
      </button>
      <button
        type="button"
        onClick={props.onToday}
        disabled={props.isToday}
        className={cn(
          'ml-0.5 flex h-8 items-center border-l border-line pl-3 pr-2.5 text-[12px] font-medium transition-colors',
          props.isToday
            ? 'cursor-not-allowed text-primary-dark opacity-60'
            : 'text-ink-muted hover:bg-surface-subtle hover:text-ink',
        )}
        aria-label="Sot"
      >
        Sot
      </button>
    </div>
  );
}

interface RevenueTileProps {
  totalCents: number;
  breakdown: DailyReportResponse['paymentCodeBreakdown'];
  loading: boolean;
}

function RevenueTile({ totalCents, breakdown, loading }: RevenueTileProps) {
  const nonZero = breakdown.filter((b) => b.count > 0);
  return (
    <div className="flex min-h-[134px] flex-col rounded-xl border border-teal-200 bg-gradient-to-b from-primary-tint to-surface-elevated px-[22px] py-[18px] shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <div className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-muted">
        Të ardhura totale
      </div>
      <div className="flex items-baseline gap-1.5 font-display text-[52px] font-semibold leading-none tracking-[-0.03em] tabular-nums text-ink-strong">
        {loading ? <span className="text-ink-faint">—</span> : centsToEur(totalCents)}
        <span className="text-[22px] font-medium text-ink-muted">€</span>
      </div>
      <div className="mt-auto pt-3 font-mono text-[11.5px] tabular-nums leading-[1.4] text-ink-muted">
        {nonZero.length === 0 ? (
          <span className="text-ink-faint">—</span>
        ) : (
          nonZero.map((b, i) => (
            <span key={b.code}>
              {i > 0 ? <span className="mx-1 text-ink-faint">·</span> : null}
              <strong className="font-semibold text-ink">{b.code}</strong>{' '}
              ×{b.count}
              {b.code === 'E' ? ' (falas)' : ` (${centsToEur(b.amountCents)}€)`}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function CountTile({
  visitCount,
  paidCount,
  loading,
}: {
  visitCount: number;
  paidCount: number;
  loading: boolean;
}) {
  const other = Math.max(visitCount - paidCount, 0);
  return (
    <div className="flex min-h-[134px] flex-col rounded-xl border border-line bg-surface-elevated px-[22px] py-[18px] shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <div className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-muted">
        Numri i vizitave
      </div>
      <div className="font-display text-[40px] font-semibold leading-none tracking-[-0.025em] tabular-nums text-ink-strong">
        {loading ? <span className="text-ink-faint">—</span> : visitCount}
      </div>
      <div className="mt-auto pt-3 font-mono text-[11.5px] tabular-nums leading-[1.4] text-ink-muted">
        <strong className="font-semibold text-ink">{paidCount}</strong> të paguara
        <span className="mx-1 text-ink-faint">·</span>
        <strong className="font-semibold text-ink">{other}</strong> të tjera
      </div>
    </div>
  );
}

function StatusTile({
  breakdown,
  loading,
}: {
  breakdown: DailyReportResponse['statusBreakdown'] | undefined;
  loading: boolean;
}) {
  const completed = breakdown?.completed ?? 0;
  const noShow = breakdown?.no_show ?? 0;
  const scheduled =
    (breakdown?.scheduled ?? 0) +
    (breakdown?.arrived ?? 0) +
    (breakdown?.in_progress ?? 0);
  const total = completed + noShow + scheduled;
  const seg = (count: number) =>
    total === 0 ? 0 : Math.max(2, (count / total) * 100);

  return (
    <div className="flex min-h-[134px] flex-col rounded-xl border border-line bg-surface-elevated px-[22px] py-[18px] shadow-[0_1px_2px_rgba(28,25,23,0.04)]">
      <div className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-ink-muted">
        Statusi i vizitave
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-subtle">
          {loading ? null : (
            <>
              {completed > 0 ? (
                <div style={{ width: `${seg(completed)}%`, background: STATUS_SOLID.completed }} className="h-full transition-[width] duration-200" />
              ) : null}
              {noShow > 0 ? (
                <div style={{ width: `${seg(noShow)}%`, background: STATUS_SOLID.no_show }} className="h-full transition-[width] duration-200" />
              ) : null}
              {scheduled > 0 ? (
                <div style={{ width: `${seg(scheduled)}%`, background: STATUS_SOLID.scheduled }} className="h-full transition-[width] duration-200" />
              ) : null}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-3.5">
          <LegendItem swatch={STATUS_SOLID.completed} label="Të përfunduara" count={completed} />
          <LegendItem swatch={STATUS_SOLID.no_show} label="Mungesa" count={noShow} />
          <LegendItem swatch={STATUS_SOLID.scheduled} label="Të planifikuara" count={scheduled} />
        </div>
      </div>
    </div>
  );
}

function LegendItem({ swatch, label, count }: { swatch: string; label: string; count: number }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-ink">
      <span className="inline-block h-[9px] w-[9px] rounded-sm" style={{ background: swatch }} />
      <span className="font-display text-[13px] font-semibold tabular-nums text-ink-strong">{count}</span>
      <span className="text-[11.5px] text-ink-muted">{label}</span>
    </div>
  );
}

interface FilterPillProps {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}

function FilterPill({ active, label, count, onClick }: FilterPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-white'
          : 'border-line bg-surface-elevated text-ink-muted hover:border-ink-faint hover:text-ink',
      )}
    >
      {label}
      <span
        className={cn(
          'rounded-full px-1.5 py-[1px] font-display text-[11px] tabular-nums',
          active ? 'bg-white/20 text-white' : 'bg-surface-subtle text-ink-muted',
        )}
      >
        {count}
      </span>
    </button>
  );
}

function VisitsTable({
  visits,
  totalCents,
  paidCount,
  otherCount,
}: {
  visits: DailyReportVisit[];
  totalCents: number;
  paidCount: number;
  otherCount: number;
}) {
  const now = useMemo(() => new Date(), []);
  return (
    <table className="w-full border-collapse tabular-nums">
      <thead>
        <tr>
          <Th className="w-[70px]">Ora</Th>
          <Th>Pacienti</Th>
          <Th className="w-[110px]">DL</Th>
          <Th className="w-[152px]">Statusi</Th>
          <Th className="w-[96px]" align="right">Pagesa</Th>
          <Th className="w-[64px]" align="center">Kodi</Th>
        </tr>
      </thead>
      <tbody>
        {visits.map((v) => (
          <VisitRow key={v.id} visit={v} now={now} />
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={2} className="border-t border-line bg-surface-subtle px-4 py-3.5 text-[12.5px] font-medium uppercase tracking-[0.06em] text-ink-muted">
            Totali
          </td>
          <td colSpan={2} className="border-t border-line bg-surface-subtle px-4 py-3.5 text-right font-mono text-[11.5px] tracking-[0.04em] text-ink-faint">
            {paidCount} të paguara · {otherCount} të tjera
          </td>
          <td className="border-t border-line bg-surface-subtle px-4 py-3.5 text-right font-display text-[18px] font-semibold tracking-[-0.005em] text-ink-strong">
            {centsToEur(totalCents)}
            <span className="ml-1 text-[14px] font-medium text-ink-muted">€</span>
          </td>
          <td className="border-t border-line bg-surface-subtle"></td>
        </tr>
      </tfoot>
    </table>
  );
}

function VisitRow({ visit, now }: { visit: DailyReportVisit; now: Date }) {
  const dimmed =
    visit.status === 'no_show' || visit.status === 'scheduled' || visit.status === 'arrived' || visit.status === 'in_progress';
  return (
    <tr
      className={cn(
        'border-b border-line-soft transition-colors hover:bg-surface-subtle',
        dimmed ? 'opacity-80' : '',
      )}
    >
      <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink-muted">{visit.time}</td>
      <td className="px-4 py-2.5">
        <span className="text-[13.5px] font-semibold tracking-[-0.005em] text-ink-strong">
          {visit.patient.firstName} {visit.patient.lastName}
        </span>
        {visit.patient.dateOfBirth ? (
          <span className="ml-1.5 text-[12px] text-ink-faint">
            {ageLabel(visit.patient.dateOfBirth, now)}
          </span>
        ) : null}
        {visit.isFirstVisit ? (
          <span className="ml-2 inline-flex items-center rounded-sm border border-line bg-surface-subtle px-1.5 py-[1px] font-mono text-[10px] uppercase tracking-[0.04em] text-ink-muted">
            Vizita e parë
          </span>
        ) : null}
      </td>
      <td className="px-4 py-2.5 font-mono text-[12px] text-ink-muted">
        {visit.patient.dateOfBirth ? formatDl(visit.patient.dateOfBirth) : '—'}
      </td>
      <td className="px-4 py-2.5">
        <StatusChip status={visit.status} />
      </td>
      <td className="px-4 py-2.5 text-right font-display text-[14px] font-semibold tracking-[-0.01em] text-ink-strong">
        {renderPayment(visit)}
      </td>
      <td className="px-4 py-2.5 text-center">
        {visit.paymentCode ? (
          <span className="inline-grid h-[22px] w-[22px] place-items-center rounded border border-line bg-surface-subtle font-mono text-[11.5px] font-semibold text-ink">
            {visit.paymentCode}
          </span>
        ) : (
          <span className="inline-grid h-[22px] w-[22px] place-items-center rounded border border-dashed border-line bg-transparent font-mono text-[11.5px] text-ink-faint">
            —
          </span>
        )}
      </td>
    </tr>
  );
}

function StatusChip({ status }: { status: DailyReportStatus }) {
  const family = chipFamily(status);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium"
      style={{
        background: family.bg,
        color: family.fg,
        borderColor: family.border,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: family.solid }} />
      {chipLabel(status)}
    </span>
  );
}

function RestrictedBanner() {
  return (
    <div className="mb-[18px] flex items-center gap-2.5 rounded-lg border border-warning-soft bg-warning-bg px-4 py-2.5 text-[12.5px] text-warning">
      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 1.5L1.5 13h13L8 1.5z" />
        <path d="M8 6v3M8 11v.5" />
      </svg>
      <span>
        <strong>Nuk keni qasje për këtë datë.</strong>{' '}
        Recepsionistët mund të shohin vetëm raportin e sotëm dhe të djeshëm.
      </span>
    </div>
  );
}

function EmptyState({
  filter,
  hasAnyVisits,
  restricted,
}: {
  filter: FilterKey;
  hasAnyVisits: boolean;
  restricted: boolean;
}) {
  let message = 'Nuk ka vizita për këtë ditë.';
  if (restricted) {
    message = 'Nuk ka të dhëna për këtë datë.';
  } else if (hasAnyVisits && filter !== 'all') {
    message = `Nuk ka vizita në filtrin "${FILTERS.find((f) => f.key === filter)?.label ?? ''}".`;
  }
  return (
    <div className="px-6 py-16 text-center">
      <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-full border border-line bg-surface-subtle text-ink-faint">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6h12M5 1.5v3M11 1.5v3" strokeLinecap="round" />
        </svg>
      </div>
      <div className="text-[13px] text-ink-muted">{message}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny utilities
// ---------------------------------------------------------------------------

function Th({
  children,
  className,
  align,
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
}) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-line bg-surface-subtle px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-ink-faint',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}

function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {dir === 'left' ? <path d="M10 12L6 8l4-4" /> : <path d="M6 4l4 4-4 4" />}
    </svg>
  );
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className={className}>
      <rect x="2" y="3" width="12" height="11" rx="1.5" />
      <path d="M2 6h12M5 1.5v3M11 1.5v3" strokeLinecap="round" />
    </svg>
  );
}

function renderPayment(v: DailyReportVisit): React.ReactNode {
  if (v.status !== 'completed') {
    return <span className="text-[14px] font-normal text-ink-faint">—</span>;
  }
  if (v.paymentCode === 'E') {
    return <span className="text-[12.5px] font-medium italic text-ink-faint">Falas</span>;
  }
  if (v.paymentAmountCents == null) {
    return <span className="text-[14px] font-normal text-ink-faint">—</span>;
  }
  return <>{centsToEur(v.paymentAmountCents)} €</>;
}

function chipFamily(status: DailyReportStatus) {
  switch (status) {
    case 'completed':
      return {
        bg: 'var(--status-completed-bg)',
        fg: 'var(--status-completed-fg)',
        border: 'var(--status-completed-border)',
        solid: 'var(--status-completed-solid)',
      };
    case 'no_show':
      return {
        bg: 'var(--status-no-show-bg)',
        fg: 'var(--status-no-show-fg)',
        border: 'var(--status-no-show-border)',
        solid: 'var(--status-no-show-solid)',
      };
    case 'scheduled':
      return {
        bg: 'var(--status-scheduled-bg)',
        fg: 'var(--status-scheduled-fg)',
        border: 'var(--status-scheduled-border)',
        solid: 'var(--status-scheduled-solid)',
      };
    case 'arrived':
    case 'in_progress':
      return {
        bg: 'var(--status-in-progress-bg)',
        fg: 'var(--status-in-progress-fg)',
        border: 'var(--status-in-progress-border)',
        solid: 'var(--status-in-progress-solid)',
      };
  }
}
