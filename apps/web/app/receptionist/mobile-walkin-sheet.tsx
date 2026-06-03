'use client';

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { BottomSheet } from '@/components/mobile/bottom-sheet';
import { NavIcon } from '@/components/mobile/nav-icon';
import { ApiError } from '@/lib/api';
import {
  ageLabel,
  formatDob,
  patientClient,
  patientInitials,
  type PatientPublicDto,
} from '@/lib/patient-client';

const DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 10;

/**
 * Receptionist walk-in flow (handoff §12.5), as a bottom sheet. Search-or-
 * create in one field: existing patients surface as tappable rows, and a
 * persistent "Krijo pacient të ri" banner (carrying the typed text) sits
 * above them so the create path is always one tap away.
 *
 * Privacy (§1.2): receptionist results are name + DOB only (searchPublic).
 * Picking a patient hands off to `onPickPatient`, which creates the walk-in
 * immediately and returns the receptionist to the calendar — the clinical
 * visit form is never shown.
 */
export function MobileWalkInSheet({
  open,
  onClose,
  onPickPatient,
  onCreateNew,
}: {
  open: boolean;
  onClose: () => void;
  onPickPatient: (patient: PatientPublicDto) => void;
  onCreateNew: (seed: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<PatientPublicDto[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebounced('');
    setResults([]);
    const h = window.setTimeout(() => inputRef.current?.focus(), 340);
    return () => window.clearTimeout(h);
  }, [open]);

  useEffect(() => {
    const h = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(h);
  }, [query]);

  useEffect(() => {
    if (!open || debounced.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    void (async () => {
      try {
        const res = await patientClient.searchPublic(debounced, SEARCH_LIMIT);
        if (seq !== seqRef.current) return;
        setResults(res.patients);
      } catch (err) {
        if (seq !== seqRef.current) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = '/login?reason=session-expired';
          return;
        }
        setResults([]);
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
    })();
  }, [debounced, open]);

  const trimmed = query.trim();

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Vizitë pa termin"
      maxHeightPct={82}
      scrollBody={false}
      data-testid="walkin-sheet"
    >
      <div className="px-[var(--m-gutter)] pb-2">
        <label className="flex h-12 items-center gap-2.5 rounded-md border border-line-strong bg-surface-elevated px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25">
          <span className="shrink-0 text-ink-faint">
            <NavIcon name="search" size={18} />
          </span>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Emri i pacientit"
            aria-label="Kërko ose krijo pacient"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 [-webkit-overflow-scrolling:touch]">
        {/* Persistent create path, always one tap away. */}
        <button
          type="button"
          onClick={() => onCreateNew(trimmed)}
          data-testid="walkin-create-new"
          className="mb-1 flex min-h-[56px] w-full items-center gap-3 border-b border-line-soft px-[var(--m-gutter)] py-2.5 text-left transition active:bg-primary-soft [-webkit-tap-highlight-color:transparent]"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-dark">
            <NavIcon name="plus" size={18} strokeWidth={2} />
          </span>
          <span className="text-[14px] font-medium text-primary-dark">
            Krijo pacient të ri
            {trimmed ? <span className="ml-1 text-ink-strong">&quot;{trimmed}&quot;</span> : null}
          </span>
        </button>

        {loading && results.length === 0 ? (
          <div className="px-[var(--m-gutter)] py-5 text-center text-[13px] text-ink-muted">
            Po kërkohet…
          </div>
        ) : results.length > 0 ? (
          <ul>
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onPickPatient(p)}
                  data-testid="walkin-result"
                  className="flex min-h-[56px] w-full items-center gap-3 px-[var(--m-gutter)] py-2 text-left transition active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-subtle text-[13px] font-semibold text-ink-muted">
                    {patientInitials(p)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink-strong">
                      {p.firstName} {p.lastName}
                    </span>
                    <span className="block truncate text-[12px] tabular-nums text-ink-muted">
                      DL {formatDob(p.dateOfBirth)}
                      {ageLabel(p.dateOfBirth) ? ` · ${ageLabel(p.dateOfBirth)}` : ''}
                    </span>
                  </span>
                  <NavIcon name="chevright" size={16} className="shrink-0 text-ink-faint" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-[var(--m-gutter)] py-6 text-center text-[12.5px] text-ink-muted">
            {trimmed ? `Asnjë rezultat për "${trimmed}".` : 'Shkruaj emrin për të gjetur pacientin.'}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
