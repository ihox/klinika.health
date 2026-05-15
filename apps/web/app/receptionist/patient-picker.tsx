'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { LastVisitDot } from '@/components/last-visit-dot';
import { patientClient, type PatientPublicDto } from '@/lib/patient-client';

import { formatDob } from '@/lib/appointment-client';

export interface PatientPickerProps {
  anchor: { x: number; y: number };
  contextLabel: string; // e.g. "E martë, 14 maj · 10:30"
  onClose: () => void;
  onPick: (patient: PatientPublicDto) => void;
  /**
   * Called when the receptionist hits "Shto pacient të ri" with the
   * current query. Slice 9 wires up the quick-add modal; for now this
   * is a hand-off hook so the picker can render in slice 8.
   */
  onAddNew: (query: string) => void;
}

export function PatientPicker({
  anchor,
  contextLabel,
  onClose,
  onPick,
  onAddNew,
}: PatientPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientPublicDto[]>([]);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Pop-over position: anchor to the click coord, but clamp to viewport.
  const style = useMemo(() => {
    const width = 320;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, anchor.x - width / 2),
    );
    const top = Math.max(8, Math.min(window.innerHeight - 320, anchor.y));
    return { left, top, width } as const;
  }, [anchor]);

  // Debounced search — 200ms matches the dedicated patient browser.
  useEffect(() => {
    const handle = window.setTimeout(async () => {
      try {
        const res = await patientClient.searchPublic(query.trim(), 8);
        setResults(res.patients);
        setFocusedIdx(0);
      } catch (err) {
        if (err instanceof ApiError) {
          // Surface as empty list — the picker isn't the place for a
          // toast (the parent owns toasts).
          setResults([]);
        }
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Focus the input on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click-outside + Escape to close.
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

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, results.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIdx < results.length) {
          const p = results[focusedIdx];
          if (p) onPick(p);
        } else if (query.trim().length > 0) {
          onAddNew(query.trim());
        }
      }
    },
    [focusedIdx, onAddNew, onPick, query, results],
  );

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-labelledby="picker-ctx"
      className="fixed z-[90] flex flex-col overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-modal"
      style={{ left: style.left, top: style.top, width: style.width }}
    >
      <div className="flex items-start justify-between gap-2 border-b border-line-soft bg-surface-subtle px-3.5 py-2.5">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-ink-muted">
            Cakto për
          </div>
          <div id="picker-ctx" className="font-display text-[13.5px] font-semibold text-ink-strong tabular-nums">
            {contextLabel}
          </div>
        </div>
        <button
          type="button"
          aria-label="Mbyll"
          className="grid h-6 w-6 place-items-center rounded text-[18px] leading-none text-ink-muted hover:bg-surface-muted hover:text-ink"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      <div className="relative border-b border-line-soft px-3 py-2.5">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Kërko pacient..."
          autoComplete="off"
          className="w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary focus:ring-2 focus:ring-primary/25"
        />
      </div>

      <div className="max-h-[220px] overflow-y-auto py-1">
        {results.length === 0 ? (
          <div className="px-3.5 py-4 text-center text-[12px] italic text-ink-faint">
            {query.length === 0
              ? 'Filloni të shkruani për të kërkuar.'
              : 'Asnjë rezultat.'}
          </div>
        ) : (
          results.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p)}
              className={cn(
                'flex w-full items-center justify-between px-3.5 py-2 text-left transition hover:bg-surface-subtle',
                idx === focusedIdx && 'bg-surface-subtle',
              )}
            >
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-ink-strong">
                  <LastVisitDot lastVisitAt={p.lastVisitAt} />
                  <span>
                    {p.firstName} {p.lastName}
                  </span>
                </div>
                <div className="text-[11.5px] text-ink-muted tabular-nums mt-px">
                  DL {formatDob(p.dateOfBirth)}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <button
        type="button"
        onClick={() => onAddNew(query.trim())}
        className="flex items-center gap-2 border-t border-line bg-surface-subtle px-3.5 py-2.5 text-[12.5px] font-medium text-primary-dark hover:bg-primary-soft"
      >
        <span className="grid h-4.5 w-4.5 place-items-center rounded border border-teal-300 bg-surface-elevated font-bold text-primary text-[13px] leading-none">
          +
        </span>
        Shto pacient të ri
        {query.trim() ? (
          <span className="text-ink-strong">&ldquo;{query.trim()}&rdquo;</span>
        ) : null}
      </button>
    </div>
  );
}
