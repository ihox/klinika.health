'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import type { AuthRole } from '@/lib/auth-client';
import { safeNavigateToPatient } from '@/lib/patient';
import {
  ageLabel,
  formatDob,
  patientInitials,
  patientClient,
} from '@/lib/patient-client';
import { isReceptionistOnlyRole } from '@/lib/visits-calendar-client';
import { LastVisitDot } from '@/components/last-visit-dot';
import { BottomSheet } from './bottom-sheet';
import { NavIcon } from './nav-icon';

const DEBOUNCE_MS = 200;
const SEARCH_LIMIT = 12;

/** The subset of patient fields the sheet renders — present on BOTH the
 *  receptionist privacy DTO (PatientPublicDto) and the full doctor DTO, so
 *  one row renderer serves both. Receptionist never receives more than
 *  this from the server (§1.2). */
interface SearchRow {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  lastVisitAt: string | null;
}

interface PatientSearchSheetProps {
  open: boolean;
  onClose: () => void;
  roles: readonly AuthRole[];
}

/**
 * The ⌘K-equivalent patient search, as a bottom sheet (handoff spec §4).
 * Universally available, but **privacy-scoped by role**:
 *
 *   - doctor / clinic_admin → `searchFull`; tapping a result opens the
 *     chart (`safeNavigateToPatient`).
 *   - receptionist-only → `searchPublic` (name + DOB only, §1.2); results
 *     are an informational lookup — there is no receptionist patient-detail
 *     route in v1, so rows are not navigable (mirrors the desktop
 *     receptionist patient list).
 *
 * "Shto pacient të ri" routes to the role's existing patient surface,
 * carrying the typed query.
 */
export function PatientSearchSheet({ open, onClose, roles }: PatientSearchSheetProps) {
  const router = useRouter();
  const receptionistOnly = isReceptionistOnlyRole(roles);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeqRef = useRef(0);

  // Reset + focus the field each time the sheet opens (after the slide).
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setDebounced('');
    setResults([]);
    setLoading(false);
    const handle = window.setTimeout(() => inputRef.current?.focus(), 340);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  // Mirror the desktop search: no API call on an empty query.
  useEffect(() => {
    if (!open) return;
    if (debounced.length === 0) {
      setResults([]);
      setLoading(false);
      return;
    }
    const seq = ++requestSeqRef.current;
    setLoading(true);
    void (async () => {
      try {
        const res = receptionistOnly
          ? await patientClient.searchPublic(debounced, SEARCH_LIMIT)
          : await patientClient.searchFull(debounced, SEARCH_LIMIT);
        if (seq !== requestSeqRef.current) return;
        setResults(res.patients as SearchRow[]);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = '/login?reason=session-expired';
          return;
        }
        setResults([]);
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    })();
  }, [debounced, open, receptionistOnly]);

  const pick = useCallback(
    (row: SearchRow) => {
      // Receptionist results are lookup-only — no patient-detail route
      // exists for them and the chart is forbidden (§1.2).
      if (receptionistOnly) return;
      onClose();
      void safeNavigateToPatient(router, row.id);
    },
    [receptionistOnly, onClose, router],
  );

  const addNew = useCallback(() => {
    const q = query.trim();
    const suffix = q ? `?q=${encodeURIComponent(q)}` : '';
    const target = receptionistOnly ? '/receptionist/pacientet' : '/doctor/pacientet';
    onClose();
    router.push(`${target}${suffix}`);
  }, [query, receptionistOnly, onClose, router]);

  const trimmed = query.trim();

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Kërko pacient"
      maxHeightPct={82}
      scrollBody={false}
      data-testid="mobile-search-sheet"
    >
      {/* Pinned search field (outside the scroll region). */}
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
            placeholder="Emër ose datëlindje"
            aria-label="Kërko pacient"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-ink outline-none placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 [-webkit-overflow-scrolling:touch]">
        {loading && results.length === 0 ? (
          <div
            role="status"
            className="flex items-center justify-center gap-2 px-[var(--m-gutter)] py-6 text-[13px] text-ink-muted"
          >
            <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-faint" />
            Po kërkohet…
          </div>
        ) : results.length > 0 ? (
          <ul role="listbox" aria-label="Rezultatet e kërkimit">
            {results.map((p) => (
              <li key={p.id}>
                <PatientResultRow
                  row={p}
                  interactive={!receptionistOnly}
                  onPick={() => pick(p)}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-[var(--m-gutter)] py-8 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-surface-subtle text-ink-faint">
              <NavIcon name="search" size={22} />
            </span>
            <span className="text-[14px] font-medium text-ink">Asnjë pacient</span>
            <span className="text-[12.5px] text-ink-muted">
              {trimmed ? `Asnjë rezultat për "${trimmed}".` : 'Shkruaj për të kërkuar.'}
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={addNew}
          className="mt-1 flex min-h-[52px] w-full items-center gap-2 border-t border-line-soft px-[var(--m-gutter)] py-3 text-left text-[14px] font-medium text-primary-dark transition active:bg-primary-soft [-webkit-tap-highlight-color:transparent]"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-primary-soft text-primary-dark">
            <NavIcon name="plus" size={16} />
          </span>
          <span>
            Shto pacient të ri
            {trimmed ? <span className="ml-1 text-ink-strong">&quot;{trimmed}&quot;</span> : null}
          </span>
        </button>
      </div>
    </BottomSheet>
  );
}

function PatientResultRow({
  row,
  interactive,
  onPick,
}: {
  row: SearchRow;
  interactive: boolean;
  onPick: () => void;
}) {
  const content = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-subtle text-[13px] font-semibold text-ink-muted">
        {patientInitials(row)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 truncate font-display text-[14px] font-semibold text-ink-strong">
          <LastVisitDot lastVisitAt={row.lastVisitAt} />
          <span className="truncate">
            {row.firstName} {row.lastName}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-[12px] tabular-nums text-ink-muted">
          DL {formatDob(row.dateOfBirth)}
          {ageLabel(row.dateOfBirth) ? ` · ${ageLabel(row.dateOfBirth)}` : ''}
        </span>
      </span>
      {interactive ? (
        <span className="shrink-0 text-ink-faint" aria-hidden>
          <NavIcon name="chevright" size={16} />
        </span>
      ) : null}
    </>
  );

  if (!interactive) {
    // Receptionist lookup row — informational, not navigable (§1.2).
    return (
      <div className="flex min-h-[56px] items-center gap-3 px-[var(--m-gutter)] py-2">
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid="mobile-search-result"
      className="flex min-h-[56px] w-full items-center gap-3 px-[var(--m-gutter)] py-2 text-left transition active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]"
    >
      {content}
    </button>
  );
}
