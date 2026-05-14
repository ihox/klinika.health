'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import {
  formatDob,
  formatLongAlbanianDate,
  toLocalParts,
} from '@/lib/appointment-client';
import {
  ALLOWED_TRANSITIONS,
  type CalendarEntry,
  type VisitStatus,
} from '@/lib/visits-calendar-client';

// Action discriminator: either a status transition (with the target
// status), a reschedule (open the booking dialog), or a delete. The
// caller maps to API calls.
export type EntryAction =
  | { kind: 'transition'; to: VisitStatus }
  | { kind: 'reschedule' }
  | { kind: 'delete' };

export interface AppointmentActionsProps {
  entry: CalendarEntry;
  anchor: { x: number; y: number };
  onClose: () => void;
  onAction: (action: EntryAction) => void;
}

const STATUS_LABEL: Record<VisitStatus, string> = {
  scheduled: 'Planifikuar',
  arrived: 'Paraqitur',
  in_progress: 'Në vizitë',
  completed: 'Kryer',
  no_show: 'Mungesë',
  cancelled: 'Anuluar',
};

// Albanian copy for each transition target, matching status-menu.html.
const TRANSITION_LABEL: Record<VisitStatus, string> = {
  // 'scheduled' is never a transition target (you can't go back to
  // scheduled once the row leaves it), but keep the key so the
  // record is exhaustive.
  scheduled: 'Rikthe te planifikuar',
  arrived: 'Shëno si arritur',
  in_progress: 'Filloi vizita',
  completed: 'Shëno si kryer',
  no_show: 'Mungoi',
  cancelled: 'Anulo',
};

// "Rikthe te paraqitur" overrides the default `arrived` label when the
// current row is in no_show or cancelled — semantically the same
// action ("set to arrived"), but the verb in Albanian reads
// "restore to arrived" rather than "mark as arrived" so the
// receptionist's intent is unmistakable.
function transitionLabel(from: VisitStatus, to: VisitStatus): string {
  if (to === 'arrived' && (from === 'no_show' || from === 'cancelled')) {
    return 'Rikthe te paraqitur';
  }
  return TRANSITION_LABEL[to];
}

// Which transitions render as "danger" (red). Mungoi + Anulo are the
// two emotionally-loaded actions; everything else is neutral.
function isDangerTransition(to: VisitStatus): boolean {
  return to === 'no_show' || to === 'cancelled';
}

// Build the ordered list of menu rows for the current entry.
function buildRows(entry: CalendarEntry): EntryAction[] {
  const rows: EntryAction[] = [];

  // Reschedule is only meaningful for a scheduled non-walk-in row.
  if (!entry.isWalkIn && entry.status === 'scheduled') {
    rows.push({ kind: 'reschedule' });
  }

  // Status transitions follow the server's ALLOWED_TRANSITIONS table.
  // Walk-ins skip the 'cancelled' transition out of scheduled (they
  // can't be cancelled — they never had a slot to cancel from),
  // which is moot since walk-ins start at 'arrived' anyway and
  // 'scheduled → cancelled' never fires.
  const allowed = ALLOWED_TRANSITIONS[entry.status] ?? [];
  for (const to of allowed) {
    rows.push({ kind: 'transition', to });
  }

  // Delete always appears last.
  rows.push({ kind: 'delete' });
  return rows;
}

// Stable string key for keyboard nav / React keys.
function rowKey(row: EntryAction): string {
  switch (row.kind) {
    case 'transition':
      return `t:${row.to}`;
    case 'reschedule':
      return 'reschedule';
    case 'delete':
      return 'delete';
  }
}

export function AppointmentActions({
  entry,
  anchor,
  onClose,
  onAction,
}: AppointmentActionsProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => buildRows(entry), [entry]);
  // Index in `rows` of the keyboard-focused item. Mouse hover doesn't
  // change focus — keyboard and mouse coexist without fighting over
  // which row is "active".
  const [focusIdx, setFocusIdx] = useState(0);

  const anchorInstant = entry.scheduledFor
    ? new Date(entry.scheduledFor)
    : entry.arrivedAt
      ? new Date(entry.arrivedAt)
      : new Date(entry.createdAt);
  const localParts = toLocalParts(anchorInstant);

  // Estimated menu height for clamping. The exact height depends on the
  // row count; ~38px per row + ~70px header is close enough to keep
  // the menu inside the viewport.
  const style = useMemo(() => {
    const width = 260;
    const approxHeight = 70 + rows.length * 38 + 40;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, anchor.x - width / 2),
    );
    const top = Math.max(
      8,
      Math.min(window.innerHeight - approxHeight - 8, anchor.y + 8),
    );
    return { left, top, width } as const;
  }, [anchor, rows.length]);

  // Click-outside + keyboard handling.
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
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => (i + 1) % rows.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => (i - 1 + rows.length) % rows.length);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        setFocusIdx(0);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        setFocusIdx(rows.length - 1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[focusIdx];
        if (row) onAction(row);
      }
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [focusIdx, onAction, onClose, rows]);

  const isWalkIn = entry.isWalkIn;
  const headerSecondary = isWalkIn
    ? `↻ Pa termin · erdhi ${localParts.time}`
    : `${formatLongAlbanianDate(localParts.date)} · ${localParts.time} · ${STATUS_LABEL[entry.status]}`;

  // Visual grouping: any reschedule rows sit at top, then status
  // transitions (with a section label), then a separator, then delete.
  // We compute the indices once for clean rendering.
  const rescheduleIdx = rows.findIndex((r) => r.kind === 'reschedule');
  const transitionStart = rows.findIndex((r) => r.kind === 'transition');
  const deleteIdx = rows.findIndex((r) => r.kind === 'delete');

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={`Veprime për ${entry.patient.firstName} ${entry.patient.lastName}`}
      className="fixed z-[60] flex flex-col overflow-hidden rounded-md border border-line bg-surface-elevated shadow-modal"
      style={{ left: style.left, top: style.top, width: style.width }}
    >
      <div className="border-b border-line-soft bg-surface-subtle px-3.5 py-2.5">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
          {headerSecondary}
        </div>
        <div className="mt-0.5 font-display text-[14px] font-semibold text-ink-strong">
          {entry.patient.firstName} {entry.patient.lastName}
        </div>
        <div className="text-[11.5px] text-ink-muted tabular-nums">
          DL {formatDob(entry.patient.dateOfBirth)}
          {entry.durationMinutes != null ? ` · ${entry.durationMinutes} min` : ''}
        </div>
      </div>

      {rescheduleIdx >= 0 ? (
        <>
          <SectionLabel>Lëviz në</SectionLabel>
          <MenuRow
            row={rows[rescheduleIdx]!}
            label="Riprogramo terminin"
            focused={focusIdx === rescheduleIdx}
            onMouseEnter={() => setFocusIdx(rescheduleIdx)}
            onClick={() => onAction(rows[rescheduleIdx]!)}
          />
          <Divider />
        </>
      ) : null}

      {transitionStart >= 0 ? (
        <>
          <SectionLabel>Gjendja e vizitës</SectionLabel>
          {rows.map((row, idx) => {
            if (row.kind !== 'transition') return null;
            return (
              <MenuRow
                key={rowKey(row)}
                row={row}
                label={transitionLabel(entry.status, row.to)}
                danger={isDangerTransition(row.to)}
                muted={row.to === 'cancelled'}
                focused={focusIdx === idx}
                onMouseEnter={() => setFocusIdx(idx)}
                onClick={() => onAction(row)}
              />
            );
          })}
          <Divider />
        </>
      ) : null}

      <MenuRow
        row={rows[deleteIdx]!}
        label={isWalkIn ? 'Fshij walk-in' : 'Fshij terminin'}
        danger
        focused={focusIdx === deleteIdx}
        onMouseEnter={() => setFocusIdx(deleteIdx)}
        onClick={() => onAction(rows[deleteIdx]!)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: string }): ReactElement {
  return (
    <div className="px-3.5 pt-2 pb-1 font-mono text-[10px] uppercase tracking-[0.08em] font-semibold text-ink-faint">
      {children}
    </div>
  );
}

function Divider(): ReactElement {
  return <div className="h-px bg-line-soft" aria-hidden />;
}

interface MenuRowProps {
  row: EntryAction;
  label: string;
  danger?: boolean;
  muted?: boolean;
  focused: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
}

function MenuRow({
  label,
  danger,
  muted,
  focused,
  onClick,
  onMouseEnter,
}: MenuRowProps): ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={cn(
        'flex items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] transition',
        focused && !danger && !muted && 'bg-surface-subtle',
        focused && danger && 'bg-danger-bg',
        !focused && !danger && !muted && 'hover:bg-surface-subtle',
        danger && 'text-danger hover:bg-danger-bg',
        muted && !danger && 'text-ink-muted',
      )}
    >
      {label}
    </button>
  );
}
