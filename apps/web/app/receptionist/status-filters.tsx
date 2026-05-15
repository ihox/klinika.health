'use client';

import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import type { CalendarEntry, VisitStatus } from '@/lib/visits-calendar-client';

/**
 * Status filter pill set above the calendar grid. Mirrors
 * design-reference/prototype/receptionist.html `.status-filters` —
 * a row of pills with counts inline. Active = solid background +
 * white text; inactive = outline + status-coloured text.
 *
 * Buckets:
 *   - all         → every visible entry
 *   - scheduled   → scheduled / arrived / in_progress (in-pipeline)
 *   - completed   → completed only
 *   - no_show     → no_show only
 *   - cancelled   → cancelled only
 *
 * `scheduled` collapses the three active statuses because the design's
 * legend (top toolbar) uses the same teal swatch for all three — the
 * receptionist reads them as "still on the books".
 */

export type StatusFilter =
  | 'all'
  | 'scheduled'
  | 'completed'
  | 'no_show'
  | 'cancelled';

const PIPELINE_STATUSES: ReadonlySet<VisitStatus> = new Set([
  'scheduled',
  'arrived',
  'in_progress',
]);

export function entryMatchesStatusFilter(
  entry: CalendarEntry,
  filter: StatusFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'scheduled') return PIPELINE_STATUSES.has(entry.status);
  return entry.status === filter;
}

export function countByStatusFilter(
  entries: ReadonlyArray<CalendarEntry>,
): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = {
    all: entries.length,
    scheduled: 0,
    completed: 0,
    no_show: 0,
    cancelled: 0,
  };
  for (const e of entries) {
    if (PIPELINE_STATUSES.has(e.status)) counts.scheduled += 1;
    else if (e.status === 'completed') counts.completed += 1;
    else if (e.status === 'no_show') counts.no_show += 1;
    else if (e.status === 'cancelled') counts.cancelled += 1;
  }
  return counts;
}

interface PillSpec {
  filter: StatusFilter;
  label: string;
  // Inline color classes — paired with the design's --primary,
  // --success, --danger, --ink-muted tokens. Active uses solid bg +
  // white text; inactive uses outline + the status color as text.
  inactiveClass: string;
  activeClass: string;
  dotClass: string;
}

const PILLS: readonly PillSpec[] = [
  {
    filter: 'all',
    label: 'Të gjitha',
    inactiveClass: 'border-ink-muted text-ink-muted',
    activeClass: 'border-transparent bg-ink text-white',
    dotClass: 'bg-ink-muted',
  },
  {
    filter: 'scheduled',
    label: 'Planifikuar',
    inactiveClass: 'border-primary text-primary',
    activeClass: 'border-transparent bg-primary text-white',
    dotClass: 'bg-primary',
  },
  {
    filter: 'completed',
    label: 'Kryer',
    inactiveClass: 'border-success text-success',
    activeClass: 'border-transparent bg-success text-white',
    dotClass: 'bg-success',
  },
  {
    filter: 'no_show',
    label: 'Mungesë',
    inactiveClass: 'border-danger text-danger',
    activeClass: 'border-transparent bg-danger text-white',
    dotClass: 'bg-danger',
  },
  {
    filter: 'cancelled',
    label: 'Anuluar',
    inactiveClass: 'border-ink-muted text-ink-muted opacity-85',
    activeClass: 'border-transparent bg-ink-muted text-white',
    dotClass: 'bg-ink-muted',
  },
];

export interface StatusFiltersProps {
  active: StatusFilter;
  counts: Record<StatusFilter, number>;
  onChange: (next: StatusFilter) => void;
}

export function StatusFilters({
  active,
  counts,
  onChange,
}: StatusFiltersProps): ReactElement {
  return (
    <div
      role="tablist"
      aria-label="Filtro sipas statusit"
      className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2.5"
    >
      <span className="mr-1 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-faint">
        Filtro
      </span>
      {PILLS.map((p) => {
        const isActive = active === p.filter;
        return (
          <button
            key={p.filter}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(p.filter)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border bg-surface-elevated px-3 py-[5px] text-[12.5px] font-medium leading-[1.3] transition',
              'hover:bg-surface-subtle',
              isActive ? p.activeClass : p.inactiveClass,
            )}
          >
            <span
              aria-hidden
              className={cn(
                'h-[7px] w-[7px] rounded-full',
                isActive ? 'bg-white/85' : p.dotClass,
              )}
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
