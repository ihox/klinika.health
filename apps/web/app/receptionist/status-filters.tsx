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
 *
 * `scheduled` collapses the three active statuses because the design's
 * legend (top toolbar) uses the same teal swatch for all three — the
 * receptionist reads them as "still on the books".
 */

export type StatusFilter =
  | 'all'
  | 'scheduled'
  | 'completed'
  | 'no_show';

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
  };
  for (const e of entries) {
    if (PIPELINE_STATUSES.has(e.status)) counts.scheduled += 1;
    else if (e.status === 'completed') counts.completed += 1;
    else if (e.status === 'no_show') counts.no_show += 1;
  }
  return counts;
}

interface PillSpec {
  filter: StatusFilter;
  label: string;
  // Canonical status-color triplets — indigo / green / amber / red.
  // The "Të gjitha" pill stays neutral. Active = solid background +
  // white text; inactive = soft bg + status fg + status border.
  inactiveClass: string;
  activeClass: string;
  dotClass: string;
}

const PILLS: readonly PillSpec[] = [
  {
    filter: 'all',
    label: 'Të gjitha',
    inactiveClass: 'border-line-strong text-ink-muted',
    activeClass: 'border-transparent bg-ink text-white',
    dotClass: 'bg-ink-muted',
  },
  {
    filter: 'scheduled',
    label: 'Planifikuar',
    inactiveClass:
      'border-status-scheduled-border bg-status-scheduled-bg text-status-scheduled-fg',
    activeClass: 'border-transparent bg-status-scheduled-solid text-white',
    dotClass: 'bg-status-scheduled-solid',
  },
  {
    filter: 'completed',
    label: 'Kryer',
    inactiveClass:
      'border-status-completed-border bg-status-completed-bg text-status-completed-fg',
    activeClass: 'border-transparent bg-status-completed-solid text-white',
    dotClass: 'bg-status-completed-solid',
  },
  {
    filter: 'no_show',
    label: 'Mungesë',
    inactiveClass:
      'border-status-no-show-border bg-status-no-show-bg text-status-no-show-fg',
    activeClass: 'border-transparent bg-status-no-show-solid text-white',
    dotClass: 'bg-status-no-show-solid',
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
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-[12.5px] font-medium leading-[1.3] transition',
              'hover:brightness-95',
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
