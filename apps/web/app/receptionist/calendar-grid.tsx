'use client';

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';
import {
  formatDayHeader,
  minutesToTime,
  timeToMinutes,
  toLocalParts,
} from '@/lib/appointment-client';
import type { HoursConfig } from '@/lib/clinic-client';
import {
  type CalendarEntry,
  LOCKED_HOVER_MESSAGE,
  PAIRABLE_STATUSES,
  type VisitStatus,
} from '@/lib/visits-calendar-client';

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
  /**
   * Right-lane click at a row where a scheduled visit exists, OR a
   * direct click on the "+ Pa termin" suggest ghost. The receptionist's
   * intent is to add a walk-in paired to that visit — the calendar-view
   * opens the patient picker and POSTs with `pairedWithVisitId` set.
   */
  onWalkinForVisit: (pairedVisit: CalendarEntry, anchor: { x: number; y: number }) => void;
  /**
   * Drag-and-drop reschedule (Fix #2). The grid surfaces a snapped
   * (date, time) pair; the parent owns the PATCH + audit + toast.
   * Only scheduled non-walk-in visits trigger this. The parent should
   * resolve to `{ ok: true }` to keep the new position, `{ ok: false,
   * message }` to revert with an error toast.
   */
  onReschedule?: (
    entry: CalendarEntry,
    next: { date: string; time: string },
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * Receptionist edit-lock predicate. Returns true for visits the
   * current session can't edit — past clinic day (yesterday+), OR
   * today + completed. Hands down from CalendarView once per render
   * (gated there on `isReceptionistOnlyRole(me.roles)`, so a doctor
   * session passes `() => false` and is never locked). Locked cards:
   *   - don't open the status menu on click
   *   - don't drag (cursor stays default, useDraggable disabled)
   *   - render a `title` hint explaining why
   *   - don't surface the "+ Pa termin" pairing ghost on the row
   * The server still enforces the rule authoritatively — this is the
   * defense-in-depth UI half.
   */
  isLocked?: (entry: CalendarEntry) => boolean;
}


const STATUS_LABEL: Record<VisitStatus, string> = {
  scheduled: 'Planifikuar',
  arrived: 'Paraqitur',
  in_progress: 'Në vizitë',
  completed: 'Kryer',
  no_show: 'Mungesë',
};

// Canonical status → Tailwind class triplet (bg + border-color + text).
// Mirrors design-reference/prototype/receptionist.html `.appt.<status>`.
// `arrived` shares the cyan family with `in_progress` — the prototype
// uses the same `--status-in-progress-*` tokens. `in_progress` adds
// the breathing animation declared in globals.css.
const STATUS_CARD_CLASSES: Record<VisitStatus, string> = {
  scheduled:
    'bg-status-scheduled-bg border-status-scheduled-border text-status-scheduled-fg',
  arrived:
    'bg-status-in-progress-bg border-status-in-progress-border text-status-in-progress-fg',
  in_progress:
    'bg-status-in-progress-bg border-status-in-progress-border text-status-in-progress-fg animate-status-in-progress',
  completed:
    'bg-status-completed-bg border-status-completed-border text-status-completed-fg',
  no_show:
    'bg-status-no-show-bg border-status-no-show-border text-status-no-show-fg',
};

// Canonical status → left-accent color used for the 3px stripe on the
// card's leading edge. Pulled from the canonical solid token of the
// matching family so the stripe pops slightly against the soft bg.
const STATUS_LEFT_ACCENT: Record<VisitStatus, string> = {
  scheduled:   'var(--status-scheduled-solid)',
  arrived:     'var(--status-in-progress-solid)',
  in_progress: 'var(--status-in-progress-solid)',
  completed:   'var(--status-completed-solid)',
  no_show:     'var(--status-no-show-solid)',
};

// Default duration assumed for walk-in rows missing one (legacy data
// pre-Phase 2b). 5 min mirrors the schema default and the snap unit.
export const WALKIN_DEFAULT_DURATION_MIN = 5;

/**
 * Pixel height for a walk-in card on the receptionist calendar.
 *
 * Walk-in cards used to be a fixed 24/36px regardless of duration;
 * Phase 2b makes the duration clinic-configurable (5–60 min) and ties
 * the visual height to it via `durationMinutes * PX_PER_MIN`. A clinic
 * setting of 10 yields 20px-tall strips; 60 yields 120px blocks.
 */
export function walkInHeightPx(durationMinutes: number | null): number {
  return (durationMinutes ?? WALKIN_DEFAULT_DURATION_MIN) * PX_PER_MIN;
}

// Out-of-range visits (scheduled_for or arrived_at outside the grid's
// open band) used to render with negative `top` and overlap the column
// header. They now pin to the top ("← më herët") or bottom ("më vonë")
// of the column body in a compact stack so the receptionist still sees
// them — the actual time stays accessible via the Fix #3 hover.
const PINNED_HEIGHT_PX = 22;
const PINNED_GAP_PX = 2;
const PINNED_STEP_PX = PINNED_HEIGHT_PX + PINNED_GAP_PX;

export type PinnedPosition =
  | { kind: 'before'; offsetPx: number }
  | { kind: 'after'; offsetPx: number };

interface ClassifiedEntry {
  entry: CalendarEntry;
  pinned: PinnedPosition | null;
}

/**
 * Bucket a day's entries into in-range vs pinned-before vs pinned-after
 * relative to the grid's open band, and pre-compute the stacking
 * offsets so each card knows where it lives. Sorted chronologically:
 *   - before: earliest at the top of the top stack
 *   - after:  latest at the very bottom of the bottom stack
 *
 * Exported for unit testing.
 */
export function classifyEntriesByGrid(
  entries: ReadonlyArray<CalendarEntry>,
  accessor: (e: CalendarEntry) => number | null,
  gridStartMin: number,
  gridEndMin: number,
): ClassifiedEntry[] {
  const inRange: ClassifiedEntry[] = [];
  const beforeRaw: Array<{ entry: CalendarEntry; sMin: number }> = [];
  const afterRaw: Array<{ entry: CalendarEntry; sMin: number }> = [];
  for (const e of entries) {
    const sMin = accessor(e);
    if (sMin == null) continue;
    if (sMin < gridStartMin) beforeRaw.push({ entry: e, sMin });
    else if (sMin >= gridEndMin) afterRaw.push({ entry: e, sMin });
    else inRange.push({ entry: e, pinned: null });
  }
  beforeRaw.sort((a, b) => a.sMin - b.sMin);
  afterRaw.sort((a, b) => a.sMin - b.sMin);
  const before: ClassifiedEntry[] = beforeRaw.map((x, i) => ({
    entry: x.entry,
    pinned: { kind: 'before', offsetPx: i * PINNED_STEP_PX },
  }));
  const after: ClassifiedEntry[] = afterRaw.map((x, i, arr) => ({
    entry: x.entry,
    pinned: { kind: 'after', offsetPx: (arr.length - 1 - i) * PINNED_STEP_PX },
  }));
  return [...before, ...inRange, ...after];
}

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
 * band is gone. Exported for unit testing.
 */
export function groupWalkInsByDay(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
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
  onWalkinForVisit,
  onReschedule,
  isLocked,
}: CalendarGridProps): ReactElement {
  // Scheduled rows feed the time grid; walk-ins feed the per-column
  // right lane. Both still positioned absolutely by time math.
  const scheduledEntries = entries.filter((e) => !e.isWalkIn);
  const walkInsByDay = groupWalkInsByDay(entries);

  // Drag preview state: which target slot the dragged card is over,
  // and whether it conflicts with another scheduled visit. Drives
  // the not-allowed cursor and the red-tinted ghost preview. Cleared
  // on drop/cancel.
  const [dragPreview, setDragPreview] = useState<{
    entryId: string;
    date: string;
    time: string;
    conflict: boolean;
  } | null>(null);

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

  // 5-min snap is 2 px/min × 5 = 10px. Only Y is snapped; X follows
  // the cursor so cross-day drag reads naturally.
  const snapYTo5Min: Modifier = useMemo(
    () => ({ transform }) => ({
      ...transform,
      y: Math.round(transform.y / 10) * 10,
    }),
    [],
  );

  // Activation distance 8px: a quick click without movement still
  // bubbles to the card's onClick (which opens the status menu). Drag
  // intent — any movement of 8+ px — activates the DnD pipeline.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // Compute (date, time) for the dragged card given an over column and
  // the active node's translated rect. Returns null when the cursor
  // hasn't crossed into any column (rare — usually a column is under
  // the cursor).
  const computeProposed = useCallback(
    (
      overDate: string,
      activeTop: number,
      overTop: number,
      entry: CalendarEntry,
    ): { date: string; time: string; conflict: boolean } | null => {
      const newTop = activeTop - overTop;
      // Snap (defense in depth — the modifier already snapped delta).
      const minutesFromGridStart = Math.round(newTop / PX_PER_MIN / 5) * 5;
      const newStartMin = gridStartMin + minutesFromGridStart;
      if (newStartMin < gridStartMin) return null;
      const newTime = minutesToTime(newStartMin);
      const dur = entry.durationMinutes ?? 0;
      const newEndMin = newStartMin + dur;
      // Conflict check against every other scheduled visit in the
      // target day. Walk-ins ignore (they live in the right lane).
      const dayEntries = byDay.get(overDate) ?? [];
      const conflict = dayEntries.some((other) => {
        if (other.id === entry.id) return false;
        if (other.scheduledFor == null || other.durationMinutes == null) return false;
        const oStart = timeToMinutes(toLocalParts(new Date(other.scheduledFor)).time);
        const oEnd = oStart + other.durationMinutes;
        return newStartMin < oEnd && newEndMin > oStart;
      });
      return { date: overDate, time: newTime, conflict };
    },
    [byDay, gridStartMin],
  );

  const handleDragMove = useCallback(
    (event: DragMoveEvent) => {
      if (!event.over) {
        if (dragPreview) setDragPreview(null);
        return;
      }
      const entry = event.active.data.current?.entry as
        | CalendarEntry
        | undefined;
      const overDate = event.over.data.current?.date as string | undefined;
      const overTop = event.over.rect.top;
      const activeRect = event.active.rect.current.translated;
      if (!entry || !overDate || !activeRect) return;
      const proposed = computeProposed(overDate, activeRect.top, overTop, entry);
      if (!proposed) {
        if (dragPreview) setDragPreview(null);
        return;
      }
      if (
        dragPreview &&
        dragPreview.entryId === entry.id &&
        dragPreview.date === proposed.date &&
        dragPreview.time === proposed.time &&
        dragPreview.conflict === proposed.conflict
      ) {
        return;
      }
      setDragPreview({ entryId: entry.id, ...proposed });
    },
    [computeProposed, dragPreview],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const entry = event.active.data.current?.entry as
        | CalendarEntry
        | undefined;
      const overDate = event.over?.data.current?.date as string | undefined;
      const overTop = event.over?.rect.top;
      const activeRect = event.active.rect.current.translated;
      setDragPreview(null);
      if (!entry || !overDate || overTop == null || !activeRect) return;
      if (!onReschedule) return;
      const proposed = computeProposed(overDate, activeRect.top, overTop, entry);
      if (!proposed || proposed.conflict) return;
      // Same-position drop: no-op
      if (entry.scheduledFor) {
        const cur = toLocalParts(new Date(entry.scheduledFor));
        if (cur.date === proposed.date && cur.time === proposed.time) return;
      }
      await onReschedule(entry, { date: proposed.date, time: proposed.time });
    },
    [computeProposed, onReschedule],
  );

  const handleDragCancel = useCallback(() => {
    setDragPreview(null);
  }, []);

  return (
    <DndContext
      sensors={sensors}
      modifiers={[snapYTo5Min]}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
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
        const isPast = col.date < todayIso;
        const hasWalkIns = (walkInsByDay.get(col.date)?.length ?? 0) > 0;
        // Two-lane split: today ALWAYS, plus any other day carrying
        // ≥1 walk-in so the band has somewhere to live. Drives the
        // header lane-hint AND the day-col background divider.
        const isTwoLane = isToday || hasWalkIns;
        return (
          <div
            key={`head-${col.date}`}
            data-has-walkins={hasWalkIns || undefined}
            data-two-lane={isTwoLane || undefined}
            data-past={isPast || undefined}
            data-today={isToday || undefined}
            className={cn(
              'border-r border-line last:border-r-0 px-3.5 py-2.5 min-h-[44px]',
              'flex items-baseline flex-wrap gap-x-2 gap-y-1',
              isToday ? 'bg-teal-100/35' : 'bg-surface-subtle',
            )}
          >
            <span
              className={cn(
                'font-display text-[12.5px] font-semibold tracking-[-0.005em] leading-[1.1] whitespace-nowrap',
                isToday
                  ? 'text-primary-dark'
                  : isPast
                    ? 'text-ink-muted font-medium'
                    : 'text-ink',
              )}
            >
              {formatDayHeader(col.weekday, col.date)}
            </span>
            {isToday ? (
              <span className="inline-flex items-center rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] leading-[1.4] text-white">
                sot
              </span>
            ) : null}
            {isTwoLane ? <LaneHint /> : null}
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
        const isPast = col.date < todayIso;
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
            isPast={isPast}
            now={now}
            gridStartMin={gridStartMin}
            gridHeightPx={gridHeightPx}
            colStartOffsetPx={closedTopOffset}
            colEndOffsetPx={closedBandTop * PX_PER_MIN}
            entries={dayEntries}
            walkIns={dayWalkIns}
            defaultDuration={hours.defaultDuration}
            dragPreview={
              dragPreview && dragPreview.date === col.date ? dragPreview : null
            }
            onSlotClick={onSlotClick}
            onEntryClick={onEntryClick}
            onEntryContextMenu={onEntryContextMenu}
            onWalkinForVisit={onWalkinForVisit}
            onReschedule={onReschedule}
            isLocked={isLocked}
          />
        );
      })}
    </div>
    </DndContext>
  );
}

interface DayColumnBodyProps {
  col: DayColumn;
  todayIso: string;
  isToday: boolean;
  isPast: boolean;
  now: Date;
  gridStartMin: number;
  gridHeightPx: number;
  colStartOffsetPx: number;
  colEndOffsetPx: number;
  entries: CalendarEntry[];
  walkIns: CalendarEntry[];
  /** Clinic's "Kohëzgjatja e parazgjedhur". Drives the hover ghost
   * height so the receptionist sees the actual default-duration
   * footprint a click would create. */
  defaultDuration: number;
  /** Set when a drag is over this specific column. Drives the
   *  drop-preview ghost + conflict tint. */
  dragPreview: { entryId: string; date: string; time: string; conflict: boolean } | null;
  onSlotClick: CalendarGridProps['onSlotClick'];
  onEntryClick: CalendarGridProps['onEntryClick'];
  onEntryContextMenu: CalendarGridProps['onEntryContextMenu'];
  onWalkinForVisit: CalendarGridProps['onWalkinForVisit'];
  onReschedule: CalendarGridProps['onReschedule'];
  isLocked: CalendarGridProps['isLocked'];
}

function DayColumnBody({
  col,
  isToday,
  isPast,
  now,
  gridStartMin,
  gridHeightPx,
  colStartOffsetPx,
  colEndOffsetPx,
  entries,
  walkIns,
  defaultDuration,
  dragPreview,
  onSlotClick,
  onEntryClick,
  onEntryContextMenu,
  onWalkinForVisit,
  onReschedule,
  isLocked,
}: DayColumnBodyProps): ReactElement {
  // Register this column body as a droppable for the DnD reschedule
  // flow. The `data.date` is read by handleDragEnd to compute the
  // target (date, time). Disabled when the column is closed —
  // dropping into a Mbyllur day shouldn't be allowed.
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `col:${col.date}`,
    data: { date: col.date },
    disabled: !col.open,
  });
  // A column is in two-lane mode whenever it carries ≥1 walk-in OR is
  // today (today's right lane is always reserved — when empty it shows
  // the "Asnjë pa termin sot" placeholder so the receptionist sees the
  // band is intentionally there). The flag drives the divider, the
  // scheduled-card right-edge clamp, and the header lane-hint.
  const hasWalkIns = walkIns.length > 0;
  const isTwoLane = isToday || hasWalkIns;
  // Grid bounds in minutes — derived from the height + start so the
  // out-of-range classifier (Fix #4) doesn't need a new prop. End is
  // exclusive: a visit at exactly `gridEndMin` is treated as "after".
  const gridEndMin = gridStartMin + Math.round(gridHeightPx / PX_PER_MIN);

  // Snap the mouse Y to the nearest 5-minute slot inside the open
  // window. Returns null when the cursor is outside hours; busy-overlap
  // and the over-an-appt case are handled separately so the hover ghost
  // and the click handler can fork on the same primitive.
  //
  // The 5-min granularity matches design-reference/prototype/
  // receptionist.html — the empty-slot ghost reads "Termin i ri · HH:MM"
  // where HH:MM is rounded to 10:05, 10:10, 10:15, ...
  const snapSlot = (
    event: React.MouseEvent<HTMLDivElement>,
  ): { targetMin: number; top: number; time: string } | null => {
    if (!col.open) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const minFromStart = Math.max(0, Math.round(y / PX_PER_MIN / 5) * 5);
    const colStart = timeToMinutes(col.startTime);
    const colEnd = timeToMinutes(col.endTime);
    const targetMin = gridStartMin + minFromStart;
    if (targetMin < colStart || targetMin + 5 > colEnd) return null;
    return {
      targetMin,
      top: (targetMin - gridStartMin) * PX_PER_MIN,
      time: minutesToTime(targetMin),
    };
  };

  // Resolve a mouse Y to the scheduled visit whose [top, top+height]
  // range contains that point. Returns null when no scheduled visit
  // overlaps the row, when the visit is in a finalized status that
  // can't be paired against, OR when the visit is locked for the
  // current receptionist session (yesterday-and-earlier rows can't be
  // paired into — the server rejects the walk-in creation with the
  // same lock check). Used both by the walk-in suggest ghost (right-
  // lane hover) and the click handler.
  const findPairableApptAtY = (y: number): CalendarEntry | null => {
    for (const a of entries) {
      if (a.scheduledFor == null || a.durationMinutes == null) continue;
      if (!PAIRABLE_STATUSES.has(a.status)) continue;
      if (isLocked && isLocked(a)) continue;
      const sMin = timeToMinutes(toLocalParts(new Date(a.scheduledFor)).time);
      const top = (sMin - gridStartMin) * PX_PER_MIN;
      const height = Math.max(20, a.durationMinutes * PX_PER_MIN);
      if (y >= top && y <= top + height) return a;
    }
    return null;
  };

  // Does an existing walk-in occupy the right-lane row at `y`? Used
  // to suppress the "+ Pa termin" suggest when a walk-in card is
  // already sitting in that slot — the suggest should never cover an
  // actual card. Out-of-range (pinned) walk-ins are ignored: they
  // render at the column edges, not at the row of any appt the
  // receptionist would be pairing against.
  const walkInOccupiesY = (yPos: number): boolean => {
    for (const w of walkIns) {
      const iso = w.arrivedAt ?? w.createdAt;
      if (!iso) continue;
      const sMin = timeToMinutes(toLocalParts(new Date(iso)).time);
      if (sMin < gridStartMin || sMin >= gridEndMin) continue;
      const top = (sMin - gridStartMin) * PX_PER_MIN;
      const height = walkInHeightPx(w.durationMinutes);
      if (yPos >= top && yPos <= top + height) return true;
    }
    return false;
  };

  // Overlap check: would a default-duration booking starting at
  // `targetMin` collide with any existing scheduled visit? Walk-ins
  // don't occupy time slots so they're ignored.
  const isSlotBusy = (targetMin: number): boolean => {
    const slotEndMin = targetMin + defaultDuration;
    return entries.some((a) => {
      if (a.scheduledFor == null || a.durationMinutes == null) return false;
      const sMin = timeToMinutes(toLocalParts(new Date(a.scheduledFor)).time);
      const eMin = sMin + a.durationMinutes;
      return targetMin < eMin && slotEndMin > sMin;
    });
  };

  // Hover state. Only one of `walkinSuggest` / `hoverSlot` is set at
  // a time — the row decides:
  //   - cursor over a row with a pairable scheduled visit → walk-in
  //     suggest ghost in the right lane (and the column expands to
  //     two-lane preview if it isn't already).
  //   - cursor over an empty 5-min slot → empty-slot ghost in the
  //     left lane labeled "Termin i ri · HH:MM".
  //   - otherwise → no ghost.
  const [walkinSuggest, setWalkinSuggest] = useState<{
    pairedVisit: CalendarEntry;
    top: number;
    height: number;
    time: string;
  } | null>(null);
  const [hoverSlot, setHoverSlot] = useState<{ top: number; time: string } | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!col.open) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const x = event.clientX - rect.left;

    // The "+ Pa termin" suggest fires only on two-lane days, only when
    // the cursor sits in the right-lane half, only at a row with a
    // pairable scheduled appt, and only when no walk-in already
    // occupies that row. Left-lane hover is reserved for the card's
    // inline expand-on-hover affordance — no cross-lane effect.
    if (isTwoLane && x > rect.width / 2) {
      const apptAtRow = findPairableApptAtY(y);
      if (
        apptAtRow &&
        apptAtRow.scheduledFor != null &&
        apptAtRow.durationMinutes != null &&
        !walkInOccupiesY(y)
      ) {
        const sMin = timeToMinutes(toLocalParts(new Date(apptAtRow.scheduledFor)).time);
        const top = (sMin - gridStartMin) * PX_PER_MIN;
        const height = Math.max(20, apptAtRow.durationMinutes * PX_PER_MIN);
        const time = minutesToTime(sMin);
        if (
          !walkinSuggest ||
          walkinSuggest.pairedVisit.id !== apptAtRow.id
        ) {
          setWalkinSuggest({ pairedVisit: apptAtRow, top, height, time });
        }
        if (hoverSlot) setHoverSlot(null);
        return;
      }
    }

    if (walkinSuggest) setWalkinSuggest(null);

    // Empty-slot path: skip when the cursor is over a card (the card's
    // own handler takes over) or when the snapped slot would overlap a
    // busy interval. Skipped on touch (mousemove doesn't fire).
    if ((event.target as HTMLElement).closest('[data-appt]')) {
      if (hoverSlot) setHoverSlot(null);
      return;
    }
    const slot = snapSlot(event);
    if (!slot || isSlotBusy(slot.targetMin)) {
      if (hoverSlot) setHoverSlot(null);
      return;
    }
    if (hoverSlot && hoverSlot.time === slot.time) return;
    setHoverSlot({ top: slot.top, time: slot.time });
  };
  const handleMouseLeave = (): void => {
    if (hoverSlot) setHoverSlot(null);
    if (walkinSuggest) setWalkinSuggest(null);
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (!col.open) return;
    // Appt cards capture their own clicks (stopPropagation in the
    // card's onClick). This guard catches the right-lane click path,
    // where the click reaches the day-col itself.
    if ((event.target as HTMLElement).closest('[data-appt]')) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const x = event.clientX - rect.left;
    const apptAtRow = findPairableApptAtY(y);

    // Walk-in suggest click: cursor over a pairable row AND the click
    // landed in the right half of the column. The right-lane area is
    // only meaningfully clickable when the column is two-lane (today
    // or has-walkins) OR during the live walk-in suggest preview.
    if (apptAtRow && x > rect.width / 2) {
      onWalkinForVisit(apptAtRow, { x: event.clientX, y: event.clientY });
      return;
    }

    const slot = snapSlot(event);
    if (!slot) return;
    onSlotClick({ date: col.date, time: slot.time });
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

  // Lane preview during hover: a single-lane day with bookings briefly
  // expands to two-lane when the receptionist hovers an appt, so the
  // "+ Pa termin" suggest ghost has somewhere to live. Matches the
  // rationale comment in design-reference/prototype/receptionist.html.
  const effectivelyTwoLane = isTwoLane || walkinSuggest !== null;

  // Background-image stack. Divider is layered FIRST so it sits visually
  // on top of the gridlines — matches the design's reading order.
  const backgroundImage = !col.open
    ? CLOSED_HATCH_BG
    : effectivelyTwoLane
      ? `${CENTER_DIVIDER_BG}, ${OPEN_GRID_BG}`
      : OPEN_GRID_BG;

  return (
    <div
      ref={setDroppableRef}
      className={cn(
        'relative border-r border-line last:border-r-0 cursor-pointer',
        !col.open && 'cursor-not-allowed bg-surface-subtle',
        isToday && col.open && 'bg-teal-100/20',
        isPast && col.open && 'bg-stone-900/[0.025]',
      )}
      style={{ height: gridHeightPx, backgroundImage }}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="grid"
      data-has-walkins={hasWalkIns || undefined}
      data-two-lane={isTwoLane || undefined}
      data-past={isPast || undefined}
      data-today={isToday || undefined}
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

      {classifyEntriesByGrid(
        entries,
        (e) =>
          e.scheduledFor != null
            ? timeToMinutes(toLocalParts(new Date(e.scheduledFor)).time)
            : null,
        gridStartMin,
        gridEndMin,
      ).map(({ entry: a, pinned }) => {
        const locked = isLocked ? isLocked(a) : false;
        return (
          <ScheduledCard
            key={a.id}
            entry={a}
            gridStartMin={gridStartMin}
            leftLaneOnly={effectivelyTwoLane}
            isPast={isPast}
            pinned={pinned}
            locked={locked}
            onClick={(ev) =>
              onEntryClick(a, { x: ev.clientX, y: ev.clientY })
            }
            onContextMenu={
              onEntryContextMenu
                ? (ev) => onEntryContextMenu(a, { x: ev.clientX, y: ev.clientY })
                : undefined
            }
            onReschedule={onReschedule}
          />
        );
      })}

      {classifyEntriesByGrid(
        walkIns,
        (e) => {
          const iso = e.arrivedAt ?? e.createdAt;
          return iso ? timeToMinutes(toLocalParts(new Date(iso)).time) : null;
        },
        gridStartMin,
        gridEndMin,
      ).map(({ entry: w, pinned }) => {
        const locked = isLocked ? isLocked(w) : false;
        return (
          <WalkInCard
            key={w.id}
            entry={w}
            gridStartMin={gridStartMin}
            isPast={isPast}
            pinned={pinned}
            locked={locked}
            onClick={(ev) =>
              onEntryClick(w, { x: ev.clientX, y: ev.clientY })
            }
            onContextMenu={
              onEntryContextMenu
                ? (ev) => onEntryContextMenu(w, { x: ev.clientX, y: ev.clientY })
                : undefined
            }
          />
        );
      })}

      {/* Drop preview — the snapped target slot during a drag. Teal
          when valid, red when the position would conflict with another
          scheduled visit. Mirrors `.drop-preview` in receptionist.html
          but driven by `dragPreview` state from CalendarGrid's DnD
          handlers. */}
      {dragPreview ? (
        <div
          className={cn(
            'absolute z-[4] pointer-events-none rounded-sm flex items-center gap-1.5 px-2 py-[3px] text-[11px] font-semibold leading-none tabular-nums shadow-[0_2px_8px_rgba(13,148,136,0.16)]',
            dragPreview.conflict
              ? 'bg-danger-bg/70 border border-danger text-danger'
              : 'bg-teal-50 border border-primary text-primary-dark',
          )}
          style={{
            top: (timeToMinutes(dragPreview.time) - gridStartMin) * PX_PER_MIN,
            height: PINNED_HEIGHT_PX + 2,
            left: 6,
            ...(isTwoLane ? { right: 'calc(50% + 2px)' } : { right: 6 }),
          }}
          aria-hidden
        >
          {dragPreview.conflict
            ? `Konflikt · ${dragPreview.time}`
            : `Zhvendos te ${dragPreview.time}`}
        </div>
      ) : null}

      {/* Today's right-lane placeholder — only when the band is empty.
          Mirrors `.lane-empty` in receptionist.html: a soft dashed card
          parked at the top of the right lane so the reserved column
          reads as intentional, not a layout bug. */}
      {isToday && !hasWalkIns && col.open ? (
        <div
          className="absolute z-0 pointer-events-none rounded-sm border border-dashed border-accent-100 bg-gradient-to-b from-[#FFFBF5] to-transparent px-2.5 pb-3 pt-2.5 text-center text-[11px] leading-[1.35] text-ink-muted"
          style={{ left: 'calc(50% + 8px)', right: 8, top: 14 }}
          aria-hidden
        >
          <span className="mb-1 block font-mono text-[9.5px] font-semibold uppercase tracking-[0.08em] text-accent-500">
            Pa termin
          </span>
          Asnjë pa termin sot
        </div>
      ) : null}

      {/* Hover slot ghost — `.ghost-slot` in receptionist.html. Height
          tracks the clinic's default duration so the receptionist sees
          the footprint a click would actually create. Lives in the
          LEFT lane when the column is two-lane (today or has-walkins)
          so it lines up with where the scheduled card will land. */}
      {hoverSlot ? (
        <div
          className="absolute z-[2] pointer-events-none flex items-center gap-1.5 rounded-sm border border-dashed border-teal-400 bg-teal-100/55 px-1.5 py-[3px] text-[11px] font-medium leading-none text-primary-dark shadow-xs tabular-nums"
          style={{
            top: hoverSlot.top,
            height: defaultDuration * PX_PER_MIN,
            left: 6,
            ...(effectivelyTwoLane ? { right: 'calc(50% + 2px)' } : { right: 6 }),
          }}
          aria-hidden
        >
          <span className="inline-grid h-3.5 w-3.5 flex-none place-items-center rounded-[3px] border border-teal-300 bg-surface-elevated text-[12px] font-bold leading-none text-primary">
            +
          </span>
          <span className="truncate">
            Termin i ri · {hoverSlot.time} · {defaultDuration} min
          </span>
        </div>
      ) : null}

      {/* Walk-in suggest ghost — `.hover-suggest-walkin` in
          receptionist.html. Appears in the right lane at the row of a
          pairable scheduled visit while the receptionist hovers. On a
          single-lane day this also flips the column into two-lane
          preview mode (effectivelyTwoLane) so the ghost has a lane to
          live in. Clicking the area routes through the day-col's
          onClick → onWalkinForVisit. */}
      {walkinSuggest ? (
        <div
          className="absolute z-[4] pointer-events-none flex items-center gap-1.5 rounded-sm border border-dashed border-accent-500 bg-accent-50 px-2 py-[3px] text-[11px] font-semibold leading-none text-[#9A3412] shadow-[0_2px_8px_rgba(249,115,22,0.16)] tabular-nums"
          style={{
            top: walkinSuggest.top,
            height: Math.min(walkinSuggest.height, 28),
            left: 'calc(50% + 2px)',
            right: 6,
            borderLeft: '3px dashed var(--accent-500, #F97316)',
          }}
          aria-hidden
        >
          <span className="inline-grid h-3.5 w-3.5 flex-none place-items-center rounded-[3px] border border-accent-400 bg-surface-elevated text-[12px] font-bold leading-none text-accent-500">
            +
          </span>
          <span className="truncate">Pa termin · {walkinSuggest.time}</span>
        </div>
      ) : null}

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
  /** Past-day fade per design: active-state appointments soften
   *  (opacity 0.85, saturate 0.78); completed/no-show/cancelled keep
   *  their explicit treatment. */
  isPast: boolean;
  /** Set when the visit's scheduled_for lies before/after the grid's
   *  open band — Fix #4. The card pins to top/bottom with a "← më
   *  herët"/"më vonë →" prefix instead of using time-derived top. */
  pinned: PinnedPosition | null;
  /** Receptionist edit-lock (per CalendarView). Locked cards don't
   *  open the status menu on click, don't drag, and surface a hover
   *  tooltip explaining why. Doctor/clinic_admin sessions always
   *  receive locked=false (the lock is per-role at the view layer). */
  locked: boolean;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Drag-drop reschedule callback (Fix #2) — also drives the
   *  Shift+Arrow keyboard fallback. Absent when the parent doesn't
   *  support reschedule. */
  onReschedule?: CalendarGridProps['onReschedule'];
}

function ScheduledCard(props: ScheduledCardProps): ReactElement | null {
  // Cards without a scheduled time or duration aren't placed on the
  // grid. Gate before the inner component so the early return doesn't
  // sit above hook calls (react-hooks/rules-of-hooks).
  if (props.entry.scheduledFor == null || props.entry.durationMinutes == null) {
    return null;
  }
  return <ScheduledCardInner {...props} />;
}

function ScheduledCardInner({
  entry,
  gridStartMin,
  leftLaneOnly,
  isPast,
  pinned,
  locked,
  onClick,
  onContextMenu,
  onReschedule,
}: ScheduledCardProps): ReactElement {
  const scheduledFor = entry.scheduledFor!;
  const durationMinutes = entry.durationMinutes!;
  const start = new Date(scheduledFor);
  const localParts = toLocalParts(start);
  const startMin = timeToMinutes(localParts.time);
  const inlineTop = (startMin - gridStartMin) * PX_PER_MIN;
  const inlineHeight = durationMinutes * PX_PER_MIN;

  const isNoShow = entry.status === 'no_show';
  const isCompleted = entry.status === 'completed';

  // Drag-and-drop reschedule: only the `scheduled` status is movable.
  // arrived/in-progress/completed/no-show cards stay anchored (you
  // don't reschedule a patient who's already arrived).
  // Walk-ins live in the right lane and aren't reachable here.
  // Pinned (out-of-range) cards: skip — the receptionist should
  // re-open them via the status menu to fix the time, not slide them
  // around an unfamiliar position.
  // Locked cards (receptionist edit-lock): skip drag too — the server
  // rejects reschedule on locked rows, so disabling the affordance
  // here keeps the receptionist from grabbing a card that would
  // bounce back with an error.
  const isDraggable = entry.status === 'scheduled' && pinned == null && !locked;
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `card:${entry.id}`,
      data: { entry, startMin, duration: entry.durationMinutes },
      disabled: !isDraggable,
    });
  const dragTransform = transform
    ? CSS.Translate.toString(transform)
    : undefined;

  // Pinned cards use a fixed compact height and pin to top/bottom of
  // the column body instead of their scheduled-for-derived position.
  // The position-overriding style fragment lives separately from the
  // normal time-derived block.
  const pinnedStyle = pinned
    ? pinned.kind === 'before'
      ? { top: pinned.offsetPx, height: PINNED_HEIGHT_PX }
      : { bottom: pinned.offsetPx, height: PINNED_HEIGHT_PX, top: 'auto' as const }
    : null;
  const pinPrefix =
    pinned == null ? null : pinned.kind === 'before' ? '← më herët' : 'më vonë →';

  // Keyboard reschedule (Shift+Arrow). Up/Down moves by 5 minutes,
  // Left/Right by one day. Lands on the same onReschedule contract
  // as the pointer drag; the server enforces the 5-min boundary and
  // conflict detection.
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (!isDraggable || !onReschedule || entry.scheduledFor == null) return;
    if (!e.shiftKey) return;
    const key = e.key;
    if (
      key !== 'ArrowUp' &&
      key !== 'ArrowDown' &&
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight'
    ) {
      return;
    }
    e.preventDefault();
    const current = new Date(entry.scheduledFor);
    const parts = toLocalParts(current);
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const minDelta = key === 'ArrowUp' ? -5 : 5;
      const sMin = timeToMinutes(parts.time) + minDelta;
      if (sMin < 0 || sMin >= 24 * 60) return;
      void onReschedule(entry, { date: parts.date, time: minutesToTime(sMin) });
    } else {
      const dayDelta = key === 'ArrowLeft' ? -1 : 1;
      const [y, m, d] = parts.date.split('-').map(Number) as [number, number, number];
      const next = new Date(Date.UTC(y, m - 1, d));
      next.setUTCDate(next.getUTCDate() + dayDelta);
      const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
      void onReschedule(entry, { date: nextDate, time: parts.time });
    }
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-appt={entry.id}
      data-status={entry.status}
      data-pinned={pinned?.kind ?? undefined}
      data-dragging={isDragging || undefined}
      {...(isDraggable ? attributes : {})}
      {...(isDraggable ? listeners : {})}
      onKeyDown={onKeyDown}
      onClick={(e) => {
        // Drag activation eats the click via the activation constraint.
        // A click without movement still reaches here and opens the
        // status menu, which is the receptionist's primary affordance.
        if (isDragging) return;
        e.stopPropagation();
        // Locked cards (receptionist edit-lock): swallow the click —
        // no status menu opens. The hover tooltip explains why. The
        // server is also authoritative; this is defense in depth.
        if (locked) return;
        onClick(e);
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (locked) return;
              onContextMenu(e);
            }
          : undefined
      }
      // Native browser `title` is reserved for the locked-card
      // explanation. Non-locked cards rely on the inline expand-on-hover
      // affordance (.appt-card .appt-time) — no native tooltip, no DOB,
      // no status text duplication of the card colour.
      title={locked ? LOCKED_HOVER_MESSAGE : undefined}
      data-locked={locked || undefined}
      aria-disabled={locked || undefined}
      className={cn(
        'appt-card absolute left-1.5 px-2 py-0.5 rounded-sm text-left border border-l-[3px] shadow-xs hover:shadow-sm flex items-center overflow-hidden',
        leftLaneOnly ? 'right-[calc(50%+2px)]' : 'right-1.5',
        STATUS_CARD_CLASSES[entry.status],
        pinned && 'border-dashed',
        isDraggable && !isDragging && 'cursor-grab',
        isDragging && 'cursor-grabbing',
        // Locked: revert to default cursor so the receptionist's
        // pointer doesn't suggest the card is interactive. The hover
        // tooltip carries the "Vizita është e mbyllur" explanation.
        locked && 'cursor-default',
      )}
      style={{
        ...(pinnedStyle ?? { top: inlineTop, height: Math.max(20, inlineHeight) }),
        borderLeftColor: STATUS_LEFT_ACCENT[entry.status],
        zIndex: pinned ? 6 : 3,
        ...(pinned ? { opacity: 0.88 } : {}),
        // Past-day fade — pipeline statuses dim slightly so the day's
        // resolved (completed/no_show) cards read as the primary
        // signal. Their canonical bg already does the heavy lifting
        // visually.
        ...(isPast && !isCompleted && !isNoShow && !pinned
          ? { opacity: 0.85, filter: 'saturate(0.78)' }
          : {}),
        ...(isDragging ? { zIndex: 100, transform: dragTransform, opacity: 0.35 } : {}),
      }}
      aria-label={`${entry.patient.firstName} ${entry.patient.lastName}, ${localParts.time}, ${STATUS_LABEL[entry.status]}${pinned ? ', jashtë orarit' : ''}`}
    >
      {/* Default reads as the patient name only. On hover/focus the
          card expands and the sibling `.appt-time` reveals the time
          inline so the card reads as "Name · HH:MM". CSS rules live in
          apps/web/app/globals.css under `.appt-card`. */}
      <span
        className={cn(
          'flex-1 min-w-0 truncate text-[12px] font-semibold leading-[1.2] tracking-[-0.005em]',
          isNoShow && 'line-through decoration-1',
        )}
      >
        {pinPrefix ? (
          <span
            className="mr-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em] text-ink-faint"
            aria-hidden
          >
            {pinPrefix}
          </span>
        ) : null}
        {entry.patient.firstName} {entry.patient.lastName}
      </span>
      <span className="appt-time" aria-hidden>
        {localParts.time}
      </span>
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
  /** Past-day fade per design: active walk-ins soften (opacity 0.9,
   *  saturate 0.82); completed walk-ins keep their finished treatment. */
  isPast: boolean;
  /** Walk-in arrived_at outside the grid band — Fix #4. Pinned to
   *  top/bottom of the right lane with a "← më herët"/"më vonë →"
   *  prefix. */
  pinned: PinnedPosition | null;
  /** Receptionist edit-lock — see ScheduledCardProps.locked. */
  locked: boolean;
  onClick: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}

function WalkInCard({
  entry,
  gridStartMin,
  isPast,
  pinned,
  locked,
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
  const inlineTop = (startMin - gridStartMin) * PX_PER_MIN;
  const height = walkInHeightPx(entry.durationMinutes);

  const isNoShow = entry.status === 'no_show';
  const isCompleted = entry.status === 'completed';

  const pinnedStyle = pinned
    ? pinned.kind === 'before'
      ? { top: pinned.offsetPx, height: PINNED_HEIGHT_PX }
      : { bottom: pinned.offsetPx, height: PINNED_HEIGHT_PX, top: 'auto' as const }
    : null;
  const pinPrefix =
    pinned == null ? null : pinned.kind === 'before' ? '← më herët' : 'më vonë →';

  return (
    <button
      type="button"
      data-appt={entry.id}
      data-walkin={entry.id}
      data-status={entry.status}
      data-pinned={pinned?.kind ?? undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (locked) return;
        onClick(e);
      }}
      onContextMenu={
        onContextMenu
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (locked) return;
              onContextMenu(e);
            }
          : undefined
      }
      // Native browser `title` is reserved for the locked-card
      // explanation; non-locked walk-ins surface their time via the
      // inline expand-on-hover affordance instead.
      title={locked ? LOCKED_HOVER_MESSAGE : undefined}
      data-locked={locked || undefined}
      aria-disabled={locked || undefined}
      className={cn(
        // Walk-ins share the canonical status palette with scheduled
        // cards. The DASHED left accent (set inline below) is the only
        // visual identifier that a card is a walk-in — strict minimal
        // body, no glyph, no badge.
        'appt-card appt-card--walkin absolute left-[calc(50%+2px)] right-1.5 px-2 py-0.5 rounded-sm text-left border shadow-xs hover:shadow-sm flex items-center overflow-hidden',
        STATUS_CARD_CLASSES[entry.status],
        pinned && 'border-dashed',
        locked && 'cursor-default',
      )}
      style={{
        ...(pinnedStyle ?? { top: inlineTop, height }),
        // Dashed left accent identifies the card as a walk-in. Color
        // tracks the canonical status family.
        borderLeftStyle: 'dashed',
        borderLeftWidth: 3,
        borderLeftColor: STATUS_LEFT_ACCENT[entry.status],
        zIndex: pinned ? 6 : 3,
        ...(pinned ? { opacity: 0.88 } : {}),
        ...(isPast && !isCompleted && !isNoShow && !pinned
          ? { opacity: 0.9, filter: 'saturate(0.82)' }
          : {}),
      }}
      aria-label={`${entry.patient.firstName} ${entry.patient.lastName}, pa termin, erdhi ${parts.time}, ${STATUS_LABEL[entry.status]}${pinned ? ', jashtë orarit' : ''}`}
    >
      <span
        className={cn(
          'flex-1 min-w-0 truncate text-[12px] font-semibold leading-[1.2] tracking-[-0.005em]',
          isNoShow && 'line-through decoration-1',
        )}
      >
        {pinPrefix ? (
          <span
            className="mr-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.04em] text-ink-faint"
            aria-hidden
          >
            {pinPrefix}
          </span>
        ) : null}
        {entry.patient.firstName} {entry.patient.lastName}
      </span>
      <span className="appt-time" aria-hidden>
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

