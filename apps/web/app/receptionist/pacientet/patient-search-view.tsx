'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import {
  ageLabel,
  formatDob,
  patientClient,
  patientInitials,
  type PatientPublicDto,
} from '@/lib/patient-client';
import { QuickAddPatientModal } from './quick-add-patient-modal';

/**
 * Receptionist patient search.
 *
 * This is the dedicated patient browser (separate from the in-context
 * search in the booking flow, slice 9). Same API endpoint, same
 * PatientPublicDto shape — only id, name, and DOB are ever rendered
 * here. Adding any other field would defeat CLAUDE.md §1.2.
 */
export function PatientSearchView() {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [results, setResults] = useState<PatientPublicDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  // Debounce the query before hitting the API — 200ms strikes a balance
  // between feeling responsive and not flooding the search SQL on every
  // keystroke.
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const runSearch = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await patientClient.searchPublic(term, 10);
      setResults(res.patients);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.body.message ?? err.message : 'Diçka shkoi keq.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runSearch(debounced);
  }, [debounced, runSearch]);

  // `/` keyboard shortcut focuses the search input (matches the
  // prototype shortcut convention).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === '/' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        document.getElementById('patient-search-input')?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showAddRow = useMemo(() => query.trim().length > 0, [query]);

  return (
    <main className="min-h-screen bg-stone-50">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-4">
          <div className="flex items-center gap-6">
            <Link href="/receptionist" className="font-display text-[20px] font-semibold tracking-[-0.02em] text-stone-900">
              klinika<span className="text-teal-700">.</span>
            </Link>
            <nav className="flex items-center gap-5 text-[14px]">
              <Link href="/receptionist" className="text-stone-600 hover:text-stone-900">
                Kalendari
              </Link>
              <span className="font-medium text-stone-900">Pacientët</span>
            </nav>
          </div>
          <Link href="/profili-im" className="text-[13px] text-stone-500 hover:text-stone-800">
            Profili im →
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-8 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-stone-900">
              Pacientët
            </h1>
            <p className="mt-1 text-[14px] text-stone-500">
              Kërko sipas emrit, mbiemrit, vitit të lindjes ose ID-së së vjetër (p.sh. „Hoxha 2024” ose „#4829”).
            </p>
          </div>
          <Button onClick={() => setQuickAddOpen(true)} size="md" variant="primary">
            + Pacient i ri
          </Button>
        </div>

        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3 3" strokeLinecap="round" />
            </svg>
          </span>
          <Input
            id="patient-search-input"
            value={query}
            placeholder="Kërko pacient... (/ për të fokusuar)"
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            autoFocus
          />
          <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px] text-stone-500">
            /
          </kbd>
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {error ? (
            <div className="px-5 py-6 text-[14px] text-amber-700">{error}</div>
          ) : results.length === 0 && !loading ? (
            <div className="px-5 py-10 text-center text-[14px] text-stone-500">
              {query.trim()
                ? `Asnjë rezultat për „${query.trim()}”.`
                : 'Shkruaj për të kërkuar, ose klikoni „Pacient i ri”.'}
            </div>
          ) : (
            <ul className="divide-y divide-stone-100">
              {results.map((p) => (
                <PatientRow key={p.id} patient={p} />
              ))}
            </ul>
          )}
          {showAddRow ? (
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              className="flex w-full items-center gap-2 border-t border-stone-100 bg-stone-50/50 px-5 py-3 text-left text-[14px] text-teal-700 transition hover:bg-stone-100"
            >
              <span aria-hidden className="text-[16px]">+</span>
              Shto pacient të ri: <strong className="text-stone-900">„{query.trim()}”</strong>
            </button>
          ) : null}
        </div>
      </section>

      <QuickAddPatientModal
        open={quickAddOpen}
        seed={query.trim()}
        onClose={() => setQuickAddOpen(false)}
        onCreated={(p) => {
          setQuickAddOpen(false);
          setQuery('');
          setResults([p, ...results]);
          setToast({ message: `${p.firstName} ${p.lastName} u shtua.`, tone: 'success' });
          window.setTimeout(() => setToast(null), 3500);
        }}
        onError={(message) => {
          setToast({ message, tone: 'error' });
          window.setTimeout(() => setToast(null), 4500);
        }}
      />

      {toast ? (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 rounded-lg border px-4 py-2.5 text-[13.5px] shadow-md ${
            toast.tone === 'success'
              ? 'border-teal-200 bg-white text-teal-800'
              : 'border-amber-200 bg-white text-amber-800'
          }`}
        >
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}

function PatientRow({ patient }: { patient: PatientPublicDto }) {
  // PatientPublicDto — id, firstName, lastName, dateOfBirth. Nothing
  // else. Adding any other field rendered here would defeat the
  // privacy boundary.
  const age = ageLabel(patient.dateOfBirth);
  return (
    <li className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-stone-50">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-[12.5px] font-medium text-teal-700">
          {patientInitials(patient)}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-medium text-stone-900">
            {patient.firstName} {patient.lastName}
          </div>
          <div className="text-[12.5px] text-stone-500">
            {patient.dateOfBirth ? `DL ${formatDob(patient.dateOfBirth)}` : 'DL pa caktuar'}
            {age ? <span> · {age}</span> : null}
          </div>
        </div>
      </div>
    </li>
  );
}
