'use client';

import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import {
  colorIndicatorForLastVisit,
  dayLabelShort,
  formatDob,
  type LastVisitColor,
  minutesToTime,
  timeToMinutes,
  toLocalParts,
} from '@/lib/appointment-client';
import type { HoursConfig } from '@/lib/clinic-client';
import { type CalendarEntry, type VisitStatus } from '@/lib/visits-calendar-client';

// Layout constants. 120px per hour = 2px per minute. The grid keeps a
// continuous open band per day (no in-day "Mbyllur" splits in v1) so a
// column's pixel height = (close − open) * 2.
const PX_PER_MIN = 2;

export interface DayColumn {
  date: string; // yyyy-mm-dd
  weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  open: boolean;
  startTime: string; // HH:MM
  endTime: string; // HH:MM
}

export interface CalendarGridProps {
  todayIso: string;
  now: Date;
  hours: HoursConfig;
  columns: DayColumn[];
  /** Every entry the receptionist can see — scheduled AND walk-ins. */
  entries: CalendarEntry[];
  onSlotClick: (params: { date: string; time: string }) => void;
  onEntryClick: (
    entry: CalendarEntry,
    anchor: { x: number; y: number },
  ) => void;
  onEntryContextMenu?: (
    entry: CalendarEntry,
    anchor: { x: number; y: number },
  ) => void;
}

const STATUS_LABEL: Record<VisitStatus, string> = {
  scheduled: 'Planifikuar',
  arrived: 'Paraqitur',
  in_progress: 'Në vizitë',
  completed: 'Kryer',
  no_show: 'Mungesë',
  cancelled: 'Anuluar',
};

// Walk-ins have no durationMinutes; height is purely visual. The
// `in_progress` variant needs the extra room for the "Në vizitë" badge.
const WALKIN_HEIGHT_PX: Record<VisitStatus, number> = {
  scheduled: 24,
  arrived: 24,
  in_progress: 36,
  completed: 24,
  no_show: 24,
  cancelled: 24,
};

// Background-image layers for the day column body. Listed first → on top.
// Mirrors receptionist.html §`.day-col.today.has-walkins`.
const CENTER_DIVIDER_BG =
  'linear-gradient(to right, transparent calc(50% - 0.5px), var(--border, #e7e5e4) calc(50% - 0.5px), var(--border, #e7e5e4) calc(50% + 0.5px), transparent calc(50% + 0.5px))';
const OPEN_GRID_BG =
  'repeating-linear-gradient(to bottom, transparent 0, transparent 19px, var(--border-soft, #f0efec) 19px, var(--border-soft, #f0efec) 20px), repeating-linear-gradient(to bottom, transparent 0, transparent 118px, var(--border-strong, #d6d3d1) 118px, var(--border-strong, #d6d3d1) 120px)';
const CLOSED_HATCH_BG =
  'repeating-linear-gradient(135deg, transparent 0, transparent 6px, rgba(0,0,0,0.025) 6px, rgba(0,0,0,0.025) 7px)';

/**
 * Bucket walk-ins by their local Belgrade date for per-column rendering.
 * Inlined here — only used by the calendar grid now that the horizontal
 * band is gone.
 */
function groupWalkInsByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  for (const e of entries) {
    if (!e.isWalkIn) continue;
    const day = e.arrivedAt
      ? toLocalParts(new Date(e.arrivedAt)).date
      : toLocalParts(new Date(e.createdAt)).date;
    if (!map.has(day)) map.set(day, []);
    map.get(day)!.push(e);
  }
  for (const [, arr] of map) {
    arr.sort((a, b) => {
      const aT = a.arrivedAt ?? a.createdAt;
      const bT = b.arrivedAt ?? b.createdAt;
      return new Date(aT).getTime() - new Date(bT).getTime();
    });
  }
  return map;
}

export function CalendarGrid({
  todayIso,
  now,
  hours,
  columns,
  entries,
  onSlotClick,
  onEntryClick,
  onEntryContextMenu,
}: CalendarGridProps): ReactElement {
  // Scheduled rows feed the time grid; walk-ins feed the per-column
  // right lane. Both still positioned absolutely by time math.
  const scheduledEntries = entries.filter((e) => !e.isWalkIn);
  const walkInsByDay = groupWalkInsByDay(entries);

  // The widest open band determines the grid height so columns line up
  // even when one day closes earlier than another. We always anchor at
  // the earliest `start` across columns and extend to the latest `end`.
  const openCols = columns.filter((c) => c.open);
  const gridStartMin =
    openCols.length === 0
      ? timeToMinutes(hours.days.mon.open ? hours.days.mon.start : '10:00')
      : openCols.reduce(
          (min, c) => Math.min(min, timeToMinutes(c.startTime)),
          Number.POSITIVE_INFINITY,
        );
  const gridEndMin =
    openCols.length === 0
      ? gridStartMin + 8 * 60
      : openCols.reduce((max, c) => Math.max(max, timeToMinutes(c.endTime)), 0);
  const totalMinutes = gridEndMin - gridStartMin;
  const gridHeightPx = totalMinutes * PX_PER_MIN;

  const hourLabels: number[] = [];
  for (let m = Math.ceil(gridStartMin / 60) * 60; m <= gridEndMin; m += 60) {
    hourLabels.push(m);
  }

  // Group scheduled entries by their local day for fast per-column rendering.
  const byDay = new Map<string, CalendarEntry[]>();
  for (const a of scheduledEntries) {
    if (a.scheduledFor == null) continue;
    const day = toLocalParts(new Date(a.scheduledFor)).date;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(a);
  }

  return (
    <div
      className="grid border-t border-line"
      style={{
        gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))`,
      }}
    >
      {/* Header row */}
      <div className="bg-surface-subtle border-r border-line" />
      {columns.map((col) => {
        const isToday = col.date === todayIso;
        const hasWalkIns = (walkInsByDay.get(col.date)?.length ?? 0) > 0;
        const [, m, d] = col.date.split('-');
        return (
          <div
            key={`head-${col.date}`}
            data-has-walkins={hasWalkIns || undefined}
            className={cn(
              'bg-surface-subtle border-r border-line last:border-r-0 px-3 py-2.5',
            )}
          >
            <div
              className={cn(
                'text-[11px] uppercase tracking-[0.08em] font-medium',
                isToday ? 'text-primary-dark' : 'text-ink-muted',
              )}
            >
              {dayLabelShort(col.weekday)}
              {isToday ? ' · sot' : ''}
            </div>
            <div
              className={cn(
                'font-display text-[18px] font-semibold mt-0.5 tabular-nums',
                isToday ? 'text-primary-dark' : 'text-ink',
              )}
            >
              {Number(d)}
              {Number(d) === 1 ? <span className="text-[10px] text-ink-faint font-normal ml-1">{m}</span> : null}
            </div>
            {hasWalkIns ? <LaneHint /> : null}
          </div>
        );
      })}

      {/* Body row — time axis + per-day columns */}
      <div className="relative border-r border-line" style={{ height: gridHeightPx }}>
        {hourLabels.map((m, idx) => (
          <div
            key={m}
            className="absolute right-0 left-0"
            style={{ top: (m - gridStartMin) * PX_PER_MIN }}
          >
            <span
              className={cn(
                'absolute right-2 text-[11px] text-ink-faint tabular-nums bg-surface-elevated px-1',
                idx === 0 ? 'top-1' : '-top-[7px]',
              )}
            >
              {minutesToTime(m)}
            </span>
          </div>
        ))}
      </div>

      {columns.map((col) => {
        const dayEntries = byDay.get(col.date) ?? [];
        const dayWalkIns = walkInsByDay.get(col.date) ?? [];
        const isToday = col.date === todayIso;
        const colStartMin = col.open ? timeToMinutes(col.startTime) : gridStartMin;
        const colEndMin = col.open ? timeToMinutes(col.endTime) : gridStartMin;
        const closedTopOffset = (colStartMin - gridStartMin) * PX_PER_MIN;
        const closedBandTop = colEndMin - gridStartMin;
        return (
          <DayColumnBody
            key={col.date}
            col={col}
            todayIso={todayIso}
            isToday={isToday}
            now={now}
            gridStartMin={gridStartMin}
            gridHeightPx={gridHeightPx}
            colStartOffsetPx={closedTopOffset}
            colEndOffsetPx={closedBandTop * PX_PER_MIN}
            entries={dayEntries}
            walkIns={dayWalkIns}
            onSlotClick={onSlotClick}
            onEntryClick={onEntryClick}
            onEntryContextMenu={onEntryContextMenu}
          />
        );
      })}
    </div>
  );
}

interface DayColumnBodyProps {
  col: DayColumn;
  todayIso: string;
  isToday: boolean;
  now: Date;
  gridStartMin: number;
  gridHeightPx: number;
  colStartOffsetPx: number;
  colEndOffsetPx: number;
  entries: CalendarEntry[];
  walkIns: CalendarEntry[];
  onSlotClick: CalendarGridProps['onSlotClick'];
  onEntryClick: CalendarGridProps['onEntryClick'];
  onEntryContextMenu: CalendarGridProps['onEntryContextMenu'];
}

function DayColumnBody({
  col,
  isToday,
  now,
  gridStartMin,
  gridHeightPx,
  colStartOffsetPx,
  colEndOffsetPx,
  entries,
  walkIns,
  onSlotClick,
  onEntryClick,
  onEntryContextMenu,
}: DayColumnBodyProps): ReactElement {
  // A column is in two-lane mode whenever it carries ≥1 walk-in. The
  // modifier alone gates the divider, the scheduled-card right-edge
  // constraint, and (in STEP 2) the header lane-hint.
  const hasWalkIns = walkIns.length > 0;

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!col.open) return;
    if ((event.target as HTMLElement).closest('[data-appt]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const minFromStart = Math.max(0, Math.round(y / PX_PER_MIN / 10) * 10);
    const colStart = timeToMinutes(col.startTime);
    const colEnd = timeToMinutes(col.endTime);
    const targetMin = (gridStartMin + minFromStart);
    if (targetMin < colStart || targetMin + 10 > colEnd) return;
    onSlotClick({ date: col.date, time: minutesToTime(targetMin) });
  };

  const nowLineTop = (() => {
    if (!isToday) return null;
    const parts = toLocalParts(now);
    if (parts.date !== col.date) return null;
    const min = timeToMinutes(parts.time);
    const top = (min - gridStartMin) * PX_PER_MIN;
    if (top < 0 || top > gridHeightPx) return null;
    return { top, label: parts.time };
  })();

  // Background-image stack. Divider is layered FIRST so it sits visually
  // on top of the gridlines — matches the design's reading order.
  const backgroundImage = !col.open
    ? CLOSED_HATCH_BG
    : hasWalkIns
      ? `${CENTER_DIVIDER_BG}, ${OPEN_GRID_BG}`
      : OPEN_GRID_BG;

  return (
    <div
      className={cn(
        'relative border-r border-line last:border-r-0 cursor-pointer',
        !col.open && 'cursor-not-allowed bg-surface-subtle',
        isToday && col.open && 'bg-teal-100/20',
      )}
      style={{ height: gridHeightPx, backgroundImage }}
      onClick={handleClick}
      role="grid"
      data-has-walkins={hasWalkIns || undefined}
      aria-label={col.open ? `Kolonë termin për ${col.date}` : `Klinika e mbyllur ${col.date}`}
    >
      {/* Closed pre-open band (if column opens later than the grid start) */}
      {col.open && colStartOffsetPx > 0 ? (
        <div
          className="absolute left-0 right-0 flex items-center justify-center gap-1.5 border-y border-dashed border-line-strong bg-surface-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-faint"
          style={{ top: 0, height: colStartOffsetPx }}
        >
          Mbyllur
        </div>
      ) : null}
      {/* Closed post-close band (if column closes earlier than grid end) */}
      {col.open && colEndOffsetPx < gridHeightPx ? (
        <div
          className="absolute left-0 right-0 flex items-center justify-center gap-1.5 border-y border-dashed border-line-strong bg-surface-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-faint"
          style={{ top: colEndOffsetPx, bottom: 0 }}
        >
          Mbyllur
        </div>
      ) : null}
      {!col.open ? (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.08em] text-ink-faint">
          Mbyllur
        </div>
      ) : null}

      {entries.map((a) => (
        <ScheduledCard
          key={a.id}
          entry={a}
          gridStartMin={gridStartMin}
          leftLaneOnly={hasWalkIns}
          onClick={(ev) =>
            onEntryClick(a, { x: ev.clientX, y: ev.clientY })
          }
          onContextMenu={
            onEntryContextMenu
              ? (ev) => onEntryContextMenu(a, { x: ev.clientX, y: ev.clientY })
              : undefined
          }
        />
      ))}

      {walkIns.map((w) => (
        <WalkInCard
          key={w.id}
          entry={w}
          gridStartMin={gridStartMin}
          onClick={(ev) =>
            onEntryClick(w, { x: ev.clientX, y: ev.clientY })
          }
          onContextMenu={
            onEntryContextMenu
              ? (ev) => onEntryContextMenu(w, { x: ev.clientX, y: ev.clientY })
              : undefined
          }
        />
      ))}

      {nowLineTop ? (
        <div
          className="absolute -left-[2px] right-0 h-[2px] bg-primary z-10 pointer-events-none"
          style={{ top: nowLineTop.top }}
          aria-hidden="true"
        >
          <span className="absolute -left-1 -top-1 w-2.5 h-2.5 bg-primary rounded-full ring-2 ring-surface-elevated" />
          <span className="absolute -left-[56px] -top-2 text-[10px] font-semibold text-primary bg-surface-elevated px-1 rounded tabular-nums">
            {nowLineTop.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}

interface ScheduledCardProps {
  entry: CalendarEntry;
  gridStartMin: number;
  /** When the column also carries walk-ins, scheduled cards live in
   * the LEFT lane — right edge clamps to the column midpoint. */
  leftLaneOnly: boolean;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}

function ScheduledCard({
  entry,
  gridStartMin,
  leftLaneOnly,
  onClick,
  onContextMenu,
}: ScheduledCardProps): ReactElement | null {
  if (entry.scheduledFor == null || entry.durationMinutes == null) return null;
  const start = new Date(entry.scheduledFor);
  const localParts = toLocalParts(start);
  const startMin = timeToMinutes(localParts.time);
  const top = (startMin - gridStartMin) * PX_PER_MIN;
  const height = entry.durationMinutes * PX_PER_MIN;
  const color = colorIndicatorForLastVisit(entry.lastVisitAt);

  const isArrived = entry.status === 'arrived';
  const isInProgress = entry.status === 'in_progress';
  const isCompleted = entry.status === 'completed';
  const isNoShow = entry.status === 'no_show';
  const isCancelled = entry.status === 'cancelled';
  const isNew = entry.isNewPatient;

  return (
    <button
      type="button"
      data-appt={entry.id}
      data-status={entry.status}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(e);
            }
          : undefined
      }
      title={`${entry.patient.firstName} ${entry.patient.lastName} · ${formatDob(entry.patient.dateOfBirth)} · ${STATUS_LABEL[entry.status]}`}
      className={cn(
        'absolute left-1.5 px-2 py-0.5 rounded text-left border bg-surface-elevated border-teal-200 border-l-[3px] border-l-primary shadow-xs transition hover:-translate-y-px hover:shadow-sm z-[3] flex items-center gap-1.5 overflow-hidden',
        !leftLaneOnly && 'right-1.5',
        isArrived && 'bg-teal-50/60 border-teal-300',
        isInProgress && 'relative bg-teal-50 border-teal-300',
        isCompleted &&
          'bg-success-bg/50 border-success-soft border-l-success opacity-90',
        isNoShow && 'border border-dashed border-danger-soft border-l-danger opacity-70',
        isCancelled && 'opacity-50',
        isNew && !isCompleted && !isNoShow && !isArrived && !isInProgress &&
          'border-l-accent-500 border-warning-soft',
      )}
      style={{
        top,
        height: Math.max(20, height),
        ...(leftLaneOnly ? { right: 'calc(50% + 2px)' } : {}),
      }}
      aria-label={`${entry.patient.firstName} ${entry.patient.lastName}, ${localParts.time}, ${STATUS_LABEL[entry.status]}`}
    >
      <span className="flex-1 min-w-0 text-[11.5px] font-semibold text-ink-strong truncate leading-[1.15]">
        <span
          className={cn(
            isCompleted && 'text-success',
            isNoShow && 'text-danger line-through decoration-1',
            isCancelled && 'line-through text-ink-faint',
            isInProgress && 'text-primary-dark',
          )}
        >
          {entry.patient.firstName} {entry.patient.lastName}
        </span>
      </span>
      <span className="flex-none flex items-center gap-1 text-[10.5px] text-ink-muted tabular-nums">
        {isArrived ? (
          <span
            className="rounded bg-primary-soft px-1 text-[9.5px] font-bold uppercase tracking-[0.04em] text-teal-800"
            aria-hidden
          >
            ✓ Arriti
          </span>
        ) : null}
        {isInProgress ? (
          <span
            className="rounded bg-primary-soft px-1 text-[9.5px] font-bold uppercase tracking-[0.04em] text-teal-800"
            aria-hidden
          >
            Në vizitë
          </span>
        ) : null}
        {isCompleted ? (
          <span aria-hidden className="text-success font-bold">✓</span>
        ) : null}
        {isNoShow ? (
          <span
            className="text-[9px] font-bold uppercase rounded bg-danger-bg text-danger px-1"
            aria-hidden
          >
            MS
          </span>
        ) : null}
        <ColorChip color={color} />
        <span className="hidden sm:inline">{localParts.time}</span>
      </span>
      {isInProgress ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_3px_rgba(13,148,136,0.22)]"
        />
      ) : null}
    </button>
  );
}

// ===========================================================================
// Walk-in card — lives in the right lane of a has-walkins column,
// positioned absolutely by arrived_at the same way scheduled cards
// position by scheduled_for. Visual treatment mirrors
// receptionist.html lines 1043-1090.
// ===========================================================================

interface WalkInCardProps {
  entry: CalendarEntry;
  gridStartMin: number;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}

function WalkInCard({
  entry,
  gridStartMin,
  onClick,
  onContextMenu,
}: WalkInCardProps): ReactElement | null {
  // arrivedAt is the canonical time signal for walk-ins. If it's
  // missing (data-corruption edge), fall back to createdAt so the card
  // still renders at a sensible position.
  const anchorIso = entry.arrivedAt ?? entry.createdAt;
  const anchor = new Date(anchorIso);
  const parts = toLocalParts(anchor);
  const startMin = timeToMinutes(parts.time);
  const top = (startMin - gridStartMin) * PX_PER_MIN;
  const height = WALKIN_HEIGHT_PX[entry.status] ?? 24;

  const isInProgress = entry.status === 'in_progress';
  const isCompleted = entry.status === 'completed';
  const isNoShow = entry.status === 'no_show';
  const isCancelled = entry.status === 'cancelled';

  // Border + background per state. Borders are composed inline so the
  // left edge can be dashed-accent while the other three sides stay
  // solid-accent (Tailwind has no per-side border-style utility).
  const borderStyle = isCompleted
    ? {
        borderTop: '1px solid var(--green-soft, #BBF7D0)',
        borderRight: '1px solid var(--green-soft, #BBF7D0)',
        borderBottom: '1px solid var(--green-soft, #BBF7D0)',
        borderLeft: '3px solid var(--green, #15803D)',
        background: 'var(--green-bg, #DCFCE7)',
      }
    : isInProgress
      ? {
          borderTop: '1px solid var(--accent-400, #FB923C)',
          borderRight: '1px solid var(--accent-400, #FB923C)',
          borderBottom: '1px solid var(--accent-400, #FB923C)',
          borderLeft: '3px solid var(--accent-500, #F97316)',
          background:
            'linear-gradient(180deg, #FFF7ED 0%, var(--bg-elevated, #FFFFFF) 100%)',
        }
      : {
          borderTop: '1px solid var(--accent-100, #FFEDD5)',
          borderRight: '1px solid var(--accent-100, #FFEDD5)',
          borderBottom: '1px solid var(--accent-100, #FFEDD5)',
          borderLeft: '3px dashed var(--accent-500, #F97316)',
          background: '#FFFBF5',
        };

  return (
    <button
      type="button"
      data-appt={entry.id}
      data-walkin={entry.id}
      data-status={entry.status}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              onContextMenu(e);
            }
          : undefined
      }
      title={`${entry.patient.firstName} ${entry.patient.lastName} · pa termin · erdhi ${parts.time} · ${STATUS_LABEL[entry.status]}`}
      className={cn(
        'absolute px-2 py-0.5 rounded text-left transition hover:-translate-y-px hover:shadow-sm shadow-xs z-[3] flex items-center gap-1.5 overflow-hidden',
        isCompleted && 'opacity-85',
        isNoShow && 'opacity-60',
        isCancelled && 'opacity-50',
      )}
      style={{
        top,
        height,
        left: 'calc(50% + 2px)',
        right: 6,
        ...borderStyle,
      }}
      aria-label={`${entry.patient.firstName} ${entry.patient.lastName}, pa termin, erdhi ${parts.time}, ${STATUS_LABEL[entry.status]}`}
    >
      <span className="flex-1 min-w-0 flex items-center gap-1 text-[11.5px] font-semibold leading-[1.15]">
        <WalkInGlyph completed={isCompleted} />
        <span
          className={cn(
            'truncate',
            isCompleted ? 'text-success' : 'text-ink-strong',
            isNoShow && 'line-through text-danger',
            isCancelled && 'line-through text-ink-faint',
          )}
        >
          {entry.patient.firstName} {entry.patient.lastName}
        </span>
        {isInProgress ? (
          <span
            className="ml-1 flex-none rounded bg-accent-500 px-1 text-[9.5px] font-bold uppercase tracking-[0.04em] text-white"
            aria-hidden
          >
            Në vizitë
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          'flex-none text-[10.5px] tabular-nums',
          isCompleted ? 'text-success' : 'text-ink-muted',
        )}
      >
        {parts.time}
      </span>
    </button>
  );
}

// ===========================================================================
// Column header lane-hint — "Termine · Pa termin" with two color swatches.
// Renders only when the column carries ≥1 walk-in (gated upstream).
// Mirrors receptionist.html lines 1091-1114.
// ===========================================================================

function LaneHint(): ReactElement {
  return (
    <div className="mt-1 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.06em] text-ink-faint">
      <span className="inline-flex items-center gap-[3px]">
        <span aria-hidden className="inline-block w-2 h-1 rounded-[1px] bg-primary" />
        Termine
      </span>
      <span aria-hidden className="text-line-strong">·</span>
      <span className="inline-flex items-center gap-[3px]">
        <span aria-hidden className="inline-block w-2 h-1 rounded-[1px] bg-accent-500" />
        Pa termin
      </span>
    </div>
  );
}

function WalkInGlyph({ completed }: { completed: boolean }): ReactElement {
  if (completed) {
    return (
      <svg
        width="10"
        height="10"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="flex-none text-success"
        aria-hidden
      >
        <path d="M3 8.5l3 3 7-7" />
      </svg>
    );
  }
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-none text-accent-600"
      aria-hidden
    >
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6" />
      <path d="M13 2.5V6h-3.5" />
    </svg>
  );
}

export function ColorChip({ color }: { color: LastVisitColor }): ReactElement | null {
  if (!color) return null;
  const colorStyles: Record<NonNullable<LastVisitColor>, string> = {
    green: 'bg-success',
    yellow: 'bg-warning',
    red: 'bg-danger',
  };
  const label: Record<NonNullable<LastVisitColor>, string> = {
    green: 'Vizita e fundit më shumë se 30 ditë',
    yellow: 'Vizita e fundit 7–30 ditë',
    red: 'Vizita e fundit brenda 7 ditëve',
  };
  return (
    <span
      aria-label={label[color]}
      title={label[color]}
      className={cn('inline-block w-2 h-2 rounded-full', colorStyles[color])}
    />
  );
}
