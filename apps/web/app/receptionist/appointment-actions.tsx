'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import {
  formatDob,
  formatLongAlbanianDate,
  toLocalParts,
} from '@/lib/appointment-client';
import type { CalendarEntry, VisitStatus } from '@/lib/visits-calendar-client';

type ActionId = 'complete' | 'no_show' | 'cancelled' | 'reschedule' | 'delete';

export interface AppointmentActionsProps {
  entry: CalendarEntry;
  anchor: { x: number; y: number };
  onClose: () => void;
  onAction: (action: ActionId) => void;
}

const ACTIONS: Array<{
  id: ActionId;
  label: string;
  destructive?: boolean;
  showWhen: (status: VisitStatus) => boolean;
}> = [
  {
    id: 'complete',
    label: 'Shëno si kryer',
    // Step 5 introduces the full status menu; for now this stays the
    // legacy single-shot "scheduled → completed" shortcut.
    showWhen: (s) => s === 'scheduled' || s === 'arrived' || s === 'in_progress',
  },
  {
    id: 'no_show',
    label: 'Shëno si mungesë',
    destructive: true,
    showWhen: (s) => s === 'scheduled' || s === 'arrived',
  },
  {
    id: 'cancelled',
    label: 'Anulo terminin',
    showWhen: (s) => s === 'scheduled',
  },
  {
    id: 'reschedule',
    label: 'Riprogramo terminin',
    // Walk-ins have no slot to move — hide reschedule on them.
    showWhen: () => true,
  },
  {
    id: 'delete',
    label: 'Fshi terminin',
    destructive: true,
    showWhen: () => true,
  },
];

const STATUS_LABEL: Record<VisitStatus, string> = {
  scheduled: 'Planifikuar',
  arrived: 'Paraqitur',
  in_progress: 'Në vizitë',
  completed: 'Kryer',
  no_show: 'Mungesë',
  cancelled: 'Anuluar',
};

export function AppointmentActions({
  entry,
  anchor,
  onClose,
  onAction,
}: AppointmentActionsProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isWalkIn = entry.isWalkIn;
  const anchorInstant = entry.scheduledFor
    ? new Date(entry.scheduledFor)
    : entry.arrivedAt
      ? new Date(entry.arrivedAt)
      : new Date(entry.createdAt);
  const localParts = toLocalParts(anchorInstant);

  const style = useMemo(() => {
    const width = 260;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, anchor.x - width / 2),
    );
    const top = Math.max(8, Math.min(window.innerHeight - 280, anchor.y + 8));
    return { left, top, width } as const;
  }, [anchor]);

  useEffect(() => {
    function onDown(e: MouseEvent): void {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      role="menu"
      className="fixed z-[60] flex flex-col overflow-hidden rounded-md border border-line bg-surface-elevated shadow-modal"
      style={{ left: style.left, top: style.top, width: style.width }}
    >
      <div className="border-b border-line-soft bg-surface-subtle px-3.5 py-2.5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
          {isWalkIn
            ? `↻ Pa termin · erdhi ${localParts.time}`
            : `${formatLongAlbanianDate(localParts.date)} · ${localParts.time} · ${STATUS_LABEL[entry.status]}`}
        </div>
        <div className="mt-0.5 font-display text-[14px] font-semibold text-ink-strong">
          {entry.patient.firstName} {entry.patient.lastName}
        </div>
        <div className="text-[11.5px] text-ink-muted tabular-nums">
          DL {formatDob(entry.patient.dateOfBirth)}
          {entry.durationMinutes != null ? ` · ${entry.durationMinutes} min` : ''}
        </div>
      </div>
      {ACTIONS.filter((a) => {
        // Walk-ins can never be rescheduled (no slot to move).
        if (a.id === 'reschedule' && isWalkIn) return false;
        return a.showWhen(entry.status);
      }).map((a) => (
        <button
          key={a.id}
          type="button"
          role="menuitem"
          onClick={() => onAction(a.id)}
          className={cn(
            'flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] transition hover:bg-surface-subtle',
            a.destructive && 'text-danger hover:bg-danger-bg',
          )}
        >
          {a.label}
        </button>
      ))}
      <div className="h-px bg-line-soft" />
      <button
        type="button"
        role="menuitem"
        onClick={onClose}
        className="px-3.5 py-2.5 text-left text-[13px] text-ink-muted transition hover:bg-surface-subtle"
      >
        Mbyll
      </button>
    </div>
  );
}
