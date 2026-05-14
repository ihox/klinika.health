'use client';

import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import {
  type CalendarEntry,
  type VisitStatus,
} from '@/lib/visits-calendar-client';
import {
  formatDob,
  toLocalParts,
} from '@/lib/appointment-client';

/**
 * Walk-in band — horizontal strip above the time grid showing every
 * `is_walk_in=true` visit per day column.
 *
 * Returns a React fragment of `1 + columns.length` grid cells so it
 * slots inside the CalendarGrid's parent `display: grid` (one axis cell
 * + one cell per day column). The parent owns the grid template; this
 * component only renders the band's row.
 *
 * Design reference: design-reference/prototype/components/walk-in-band.html
 * + design-reference/prototype/components/walk-in-chip.html.
 */
export interface WalkInBandProps {
  columns: Array<{ date: string }>;
  todayIso: string;
  walkInsByDay: Map<string, CalendarEntry[]>;
  onEntryClick?: (
    entry: CalendarEntry,
    anchor: { x: number; y: number },
  ) => void;
  onEntryContextMenu?: (
    entry: CalendarEntry,
    anchor: { x: number; y: number },
  ) => void;
}

export function WalkInBand({
  columns,
  todayIso,
  walkInsByDay,
  onEntryClick,
  onEntryContextMenu,
}: WalkInBandProps): ReactElement {
  return (
    <>
      {/* Axis cell */}
      <div className="bg-surface-subtle border-r border-line border-b min-h-[70px] flex flex-col gap-1 px-2 py-2.5">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] font-semibold text-ink-muted">
          Pa termin
        </span>
        <span className="text-ink-faint mt-1">
          <WalkInIcon size={14} />
        </span>
      </div>

      {/* Day cells */}
      {columns.map((col) => {
        const entries = walkInsByDay.get(col.date) ?? [];
        const isToday = col.date === todayIso;
        return (
          <div
            key={`band-${col.date}`}
            className={cn(
              'border-r border-line border-b last:border-r-0 min-h-[70px] overflow-x-auto px-2 py-2 bg-surface-subtle',
              isToday && 'bg-teal-50/30',
            )}
          >
            {entries.length === 0 ? (
              <div className="flex h-full min-h-[50px] items-center px-1 text-[11px] italic text-ink-faint">
                Asnjë pacient pa termin
              </div>
            ) : (
              <>
                <div className="mb-1 flex items-center justify-between px-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.06em] font-semibold text-ink-faint">
                    Pa termin
                  </span>
                  <span
                    className={cn(
                      'rounded-pill border px-1.5 py-px text-[10px] font-semibold tabular-nums',
                      'bg-primary-soft border-teal-200 text-teal-800',
                    )}
                  >
                    {entries.length}
                  </span>
                </div>
                <div className="flex gap-1.5">
                  {entries.map((entry) => (
                    <WalkInChip
                      key={entry.id}
                      entry={entry}
                      onClick={onEntryClick}
                      onContextMenu={onEntryContextMenu}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

interface WalkInChipProps {
  entry: CalendarEntry;
  onClick?: (
    entry: CalendarEntry,
    anchor: { x: number; y: number },
  ) => void;
  onContextMenu?: (
    entry: CalendarEntry,
    anchor: { x: number; y: number },
  ) => void;
}

function WalkInChip({
  entry,
  onClick,
  onContextMenu,
}: WalkInChipProps): ReactElement {
  const arrivalTime = entry.arrivedAt ? toLocalParts(new Date(entry.arrivedAt)).time : '—';
  const isCompleted = entry.status === 'completed';
  const isInProgress = entry.status === 'in_progress';
  const isCancelled = entry.status === 'cancelled' || entry.status === 'no_show';

  return (
    <button
      type="button"
      data-walkin={entry.id}
      data-status={entry.status}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(entry, { x: e.clientX, y: e.clientY });
      }}
      onContextMenu={(e) => {
        if (!onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(entry, { x: e.clientX, y: e.clientY });
      }}
      title={`${entry.patient.firstName} ${entry.patient.lastName} · pa termin · erdhi ${arrivalTime}`}
      className={cn(
        'relative flex flex-none flex-col gap-px rounded text-left',
        'min-w-[138px] max-w-[168px] px-2 py-1.5 pl-[9px]',
        'border border-teal-200 border-l-[3px] border-l-primary border-l-dashed',
        'bg-surface-elevated shadow-xs transition hover:-translate-y-px hover:shadow-sm',
        isInProgress && [
          'bg-teal-50 border-teal-300 border-l-solid',
          'animate-pulse-soft',
        ],
        isCompleted && [
          'bg-success-bg border-success-soft border-l-solid border-l-success opacity-90',
        ],
        isCancelled && 'opacity-60',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className={cn(
            'flex-none',
            isCompleted ? 'text-success' : 'text-primary',
          )}
        >
          <WalkInIcon size={11} strokeWidth={1.7} />
        </span>
        <span
          className={cn(
            'flex-1 min-w-0 truncate text-[11.5px] font-semibold leading-tight',
            isCompleted ? 'text-success' : 'text-ink-strong',
            isCancelled && 'line-through text-ink-faint',
          )}
        >
          {entry.patient.firstName} {entry.patient.lastName}
        </span>
      </span>
      <span className="flex items-center gap-1.5 text-[10.5px] tabular-nums leading-tight text-ink-muted">
        <span className="text-ink-faint">
          {formatDob(entry.patient.dateOfBirth)}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-0.5 font-medium',
            isCompleted ? 'text-success' : 'text-primary-dark',
          )}
        >
          <WalkInIcon
            size={9}
            strokeWidth={2}
            className={isCompleted ? 'text-success' : 'text-primary'}
          />
          {arrivalTime}
        </span>
      </span>
      {isInProgress ? (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_0_3px_rgba(13,148,136,0.22)]"
        />
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icon — circular arrow / rotate. Reused from the design prototype.
// ---------------------------------------------------------------------------

interface WalkInIconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function WalkInIcon({
  size = 11,
  strokeWidth = 1.5,
  className,
}: WalkInIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6" />
      <path d="M13 2.5V6h-3.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helper: split entries into per-day buckets for the band's prop shape.
// ---------------------------------------------------------------------------

export function groupWalkInsByDay(
  entries: CalendarEntry[],
): Map<string, CalendarEntry[]> {
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

/**
 * Bridge type re-exports — callers shouldn't depend on the client
 * module for the band's status enum.
 */
export type { VisitStatus };
