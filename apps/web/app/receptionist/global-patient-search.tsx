'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import { LastVisitDot } from '@/components/last-visit-dot';
import {
  formatDobAndPlace,
  patientClient,
  type PatientPublicDto,
} from '@/lib/patient-client';

/**
 * Path 2 entry point — the "search anywhere" field in the receptionist's
 * top bar. Always reachable so the parent can field a phone call
 * without leaving the calendar.
 *
 * Keyboard:
 *   - `/`         focuses the field from anywhere on the page
 *   - `↑` / `↓`   navigate the result list
 *   - `Enter`     picks the focused row (or "Shto pacient të ri" when
 *                 no matches)
 *   - `Esc`       collapses the dropdown
 */
export interface GlobalPatientSearchProps {
  onPick: (patient: PatientPublicDto) => void;
  onAddNew: (query: string) => void;
}

export function GlobalPatientSearch({
  onPick,
  onAddNew,
}: GlobalPatientSearchProps): ReactElement {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PatientPublicDto[]>([]);
  const [focusedIdx, setFocusedIdx] = useState(0);
  const [open, setOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Global `/` keybinding — matches the prototype's "tastiera është
  // first-class" note. Skip when an input is already focused.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === '/' && !isEditableTarget(e.target)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Debounced search — 200ms, same as the slot picker.
  useEffect(() => {
    if (!open) return undefined;
    const handle = window.setTimeout(async () => {
      try {
        const res = await patientClient.searchPublic(query.trim(), 8);
        setResults(res.patients);
        setFocusedIdx(0);
      } catch (err) {
        if (err instanceof ApiError) {
          setResults([]);
        }
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [open, query]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent): void {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const reset = useCallback(() => {
    setQuery('');
    setResults([]);
    setFocusedIdx(0);
    setOpen(false);
  }, []);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        inputRef.current?.blur();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx((i) => Math.min(i + 1, results.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIdx < results.length) {
          const p = results[focusedIdx];
          if (p) {
            onPick(p);
            reset();
          }
        } else if (query.trim().length > 0) {
          onAddNew(query.trim());
          reset();
        }
      }
    },
    [focusedIdx, onAddNew, onPick, query, reset, results],
  );

  return (
    <div ref={containerRef} className="relative">
      <label
        className={cn(
          'flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-[13px] transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25',
          open && 'border-primary ring-2 ring-primary/25',
        )}
      >
        <SearchIcon className="text-ink-faint" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
          placeholder="Kërko pacient... ( / )"
          aria-label="Kërko pacient"
          autoComplete="off"
          className="w-[260px] bg-transparent text-ink outline-none placeholder:text-ink-faint"
        />
      </label>

      {open ? (
        <div
          role="listbox"
          aria-label="Rezultatet e kërkimit"
          className="absolute right-0 top-full z-[80] mt-2 w-[320px] overflow-hidden rounded-md border border-line bg-surface-elevated shadow-modal"
        >
          {results.length === 0 ? (
            <div className="px-3.5 py-4 text-center text-[12px] italic text-ink-faint">
              {query.trim().length === 0
                ? 'Filloni të shkruani për të kërkuar.'
                : 'Asnjë rezultat.'}
            </div>
          ) : (
            <div className="max-h-[260px] overflow-y-auto py-1">
              {results.map((p, idx) => (
                <button
                  key={p.id}
                  type="button"
                  role="option"
                  aria-selected={idx === focusedIdx}
                  onMouseEnter={() => setFocusedIdx(idx)}
                  onClick={() => {
                    onPick(p);
                    reset();
                  }}
                  className={cn(
                    'flex w-full items-center justify-between px-3.5 py-2 text-left transition hover:bg-surface-subtle',
                    idx === focusedIdx && 'bg-surface-subtle',
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate font-display text-[13.5px] font-semibold text-ink-strong">
                      <LastVisitDot lastVisitAt={p.lastVisitAt} />
                      <span className="truncate">
                        {p.firstName} {p.lastName}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-[11.5px] text-ink-muted tabular-nums">
                      {formatDobAndPlace(p.dateOfBirth, p.placeOfBirth)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              onAddNew(query.trim());
              reset();
            }}
            className="flex w-full items-center gap-2 border-t border-line bg-surface-subtle px-3.5 py-2.5 text-[12.5px] font-medium text-primary-dark hover:bg-primary-soft"
          >
            <span className="grid h-4 w-4 place-items-center rounded border border-teal-300 bg-surface-elevated font-bold text-primary text-[12px] leading-none">
              +
            </span>
            Shto pacient të ri
            {query.trim() ? (
              <span className="text-ink-strong">&ldquo;{query.trim()}&rdquo;</span>
            ) : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SearchIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
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
