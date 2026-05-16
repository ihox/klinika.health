'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import { ApiError } from '@/lib/api';
import { safeNavigateToPatient } from '@/lib/patient';
import {
  ageLabel,
  formatDob,
  patientClient,
  type PatientFullDto,
} from '@/lib/patient-client';
import { isMac, modKShortcut } from '@/lib/platform';
import { cn } from '@/lib/utils';

const SEARCH_LIMIT = 8;
const DEBOUNCE_MS = 150;

/**
 * Doctor's clinic-wide patient search. Sits in the top nav between
 * the menu items and the user chip; ⌘K (Mac) / Ctrl+K (Win/Linux)
 * focuses it from anywhere on the dashboard.
 *
 * Selecting a result calls `safeNavigateToPatient`, which routes to
 * the chart when the master record is complete and to the master-data
 * form when it isn't. The "Shiko të gjithë pacientët →" overflow
 * footer appears when the API returns the full window (likely more
 * matches beyond the eight we render here).
 *
 * Unlike the receptionist version (which uses `/` and offers an
 * inline "Shto pacient të ri" action), this surface is read-only —
 * the doctor opens charts; new-patient creation lives on
 * /doctor/pacientet.
 */
export function GlobalPatientSearch(): ReactElement {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<PatientFullDto[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Track the latest in-flight request so a late response from an
  // earlier keystroke can't overwrite the current results.
  const requestSeqRef = useRef(0);

  // Debounce the active query — 150ms per the spec, slightly snappier
  // than the receptionist's 200ms.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Run the search when the debounced query changes. Empty → reset.
  useEffect(() => {
    if (debounced.length === 0) {
      setResults([]);
      setLoading(false);
      setHighlightedIdx(0);
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    (async () => {
      try {
        const res = await patientClient.searchFull(debounced, SEARCH_LIMIT);
        if (seq !== requestSeqRef.current) return;
        setResults(res.patients);
        setHighlightedIdx(0);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = '/login?reason=session-expired';
          return;
        }
        setResults([]);
      } finally {
        if (seq === requestSeqRef.current) {
          setLoading(false);
        }
      }
    })();
  }, [debounced]);

  // Global ⌘K (Mac) / Ctrl+K (Win/Linux) shortcut: focus the input
  // from anywhere on the page. Skips when the user is already typing
  // into a different input to avoid stealing focus mid-edit unless
  // they explicitly hit the chord.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const modPressed = isMac ? e.metaKey : e.ctrlKey;
      if (modPressed && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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

  const navigateToPatient = useCallback(
    (patient: PatientFullDto) => {
      setOpen(false);
      setQuery('');
      setDebounced('');
      setResults([]);
      void safeNavigateToPatient(router, patient.id);
    },
    [router],
  );

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
        if (results.length === 0) return;
        setHighlightedIdx((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length === 0) return;
        setHighlightedIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const picked = results[highlightedIdx];
        if (picked) navigateToPatient(picked);
      }
    },
    [highlightedIdx, navigateToPatient, results],
  );

  const trimmed = query.trim();
  const showOverflow = results.length === SEARCH_LIMIT && trimmed.length > 0;
  const overflowHref = useMemo(
    () => `/doctor/pacientet?q=${encodeURIComponent(trimmed)}`,
    [trimmed],
  );

  return (
    <div ref={containerRef} className="relative">
      <label
        className={cn(
          'flex h-9 w-[360px] items-center gap-2 rounded-md border border-line-strong bg-surface-elevated px-3 text-[13px] transition',
          'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25',
          open && 'border-primary ring-2 ring-primary/25',
        )}
      >
        <SearchIcon className="shrink-0 text-ink-faint" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(e.target.value.trim().length > 0);
          }}
          onFocus={() => {
            if (query.trim().length > 0) setOpen(true);
          }}
          onKeyDown={handleKey}
          placeholder="Kërko Pacient"
          aria-label="Kërko pacient në klinikë"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="doctor-global-search-results"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd
          aria-hidden
          className="hidden shrink-0 rounded border border-line bg-surface-subtle px-1.5 py-0.5 font-mono text-[11px] text-ink-faint sm:inline-block"
        >
          {modKShortcut}
        </kbd>
      </label>

      {open ? (
        <div
          id="doctor-global-search-results"
          role="listbox"
          aria-label="Rezultatet e kërkimit të pacientëve"
          className="absolute right-0 top-full z-[60] mt-2 w-[400px] overflow-hidden rounded-md border border-line bg-surface-elevated shadow-modal"
        >
          {loading && results.length === 0 ? (
            <div
              role="status"
              className="flex items-center justify-center gap-2 px-3.5 py-4 text-[12.5px] text-ink-muted"
            >
              <span
                aria-hidden
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint"
              />
              Po kërkohet…
            </div>
          ) : results.length === 0 ? (
            <div className="px-3.5 py-4 text-center text-[12.5px] italic text-ink-faint">
              Nuk u gjet asnjë pacient.
            </div>
          ) : (
            <ul className="max-h-[320px] overflow-y-auto py-1">
              {results.map((p, idx) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={idx === highlightedIdx}
                    onMouseEnter={() => setHighlightedIdx(idx)}
                    onClick={() => navigateToPatient(p)}
                    className={cn(
                      'grid w-full grid-cols-[1fr_auto] items-center gap-3 px-3.5 py-2 text-left transition',
                      idx === highlightedIdx
                        ? 'bg-surface-subtle'
                        : 'hover:bg-surface-subtle',
                    )}
                    data-testid="doctor-global-search-result"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-display text-[13.5px] font-semibold text-ink-strong">
                        {p.firstName} {p.lastName}
                      </div>
                      <div className="mt-0.5 truncate text-[11.5px] text-ink-muted">
                        {formatAgeAndSex({
                          dateOfBirth: p.dateOfBirth,
                          sex: p.sex,
                        }) || '—'}
                      </div>
                    </div>
                    <div className="text-right font-mono text-[11px] tabular-nums text-ink-faint">
                      {formatDob(p.dateOfBirth)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {showOverflow ? (
            <a
              href={overflowHref}
              className="flex items-center justify-between border-t border-line bg-surface-subtle px-3.5 py-2 text-[12px] font-medium text-primary-dark hover:bg-primary-soft"
              onClick={() => {
                setOpen(false);
              }}
            >
              <span>Shiko të gjithë pacientët</span>
              <span aria-hidden>→</span>
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compose the second-line meta on a search result row: age + sex,
 * joined by " · ". Either half may be missing (receptionist quick-add
 * patients arrive with a null DOB and a null sex until the doctor
 * completes the record); the helper returns whichever halves are
 * available.
 *
 * Exported for unit tests. `asOf` lets the spec freeze "today" so the
 * age math is deterministic.
 */
export function formatAgeAndSex(
  p: Pick<PatientFullDto, 'dateOfBirth' | 'sex'>,
  asOf: Date = new Date(),
): string {
  const parts: string[] = [];
  const age = ageLabel(p.dateOfBirth, asOf);
  if (age) parts.push(age);
  if (p.sex === 'f') parts.push('vajzë');
  else if (p.sex === 'm') parts.push('djalë');
  return parts.join(' · ');
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
