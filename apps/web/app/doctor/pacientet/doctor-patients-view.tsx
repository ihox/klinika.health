'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { ClinicTopNav } from '@/components/clinic-top-nav';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useMe } from '@/lib/use-me';
import { chartPath, masterDataPath, safeNavigateToPatient } from '@/lib/patient';
import {
  ageLabel,
  formatDob,
  patientClient,
  patientInitials,
  type PatientFullDto,
} from '@/lib/patient-client';
import { PatientFullForm } from './patient-full-form';

/**
 * Doctor patient browser — full PatientFullDto with all master-data
 * fields. The receptionist's view at `/receptionist/pacientet` uses
 * the public DTO; both screens share the same API surface, the
 * server's role-based serialiser does the filtering.
 *
 * This is a LIST view only: clicking a row navigates to the chart
 * (when the patient is complete) or the master-data form (when
 * not). The right pane is reserved for the in-place "+ I ri" create
 * form; after creation the doctor is routed to the new patient.
 */
export function DoctorPatientsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Legacy deep link from the doctor dashboard: `?patientId=…`. The
  // dashboard now calls `navigateToPatient` directly so this only
  // fires for stale bookmarks; we forward to the chart/master-data
  // form so the saved URL keeps working.
  const initialPatientId = searchParams?.get('patientId') ?? null;
  // `?q=…` pre-fills the search box — used by the top-nav global
  // patient search's "Shiko të gjithë pacientët →" overflow link so
  // the doctor lands here mid-thought and continues filtering.
  const initialQuery = searchParams?.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  const [results, setResults] = useState<PatientFullDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const runSearch = useCallback(async (term: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await patientClient.searchFull(term, 20);
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

  // Stale `?patientId=…` deep links: forward to the chart/master-data
  // form using the same completeness predicate the dashboard uses.
  useEffect(() => {
    if (!initialPatientId) return;
    void safeNavigateToPatient(router, initialPatientId);
  }, [initialPatientId, router]);

  const openPatient = useCallback(
    (p: PatientFullDto) => {
      // Route to the chart when complete, to the master-data form
      // when not. We have the dto already (the row was clicked in
      // the search results), so we can branch locally without the
      // extra getOne fetch `navigateToPatient` would do.
      router.push(p.isComplete ? chartPath(p.id) : masterDataPath(p.id));
    },
    [router],
  );

  const handleCreated = useCallback(
    (p: PatientFullDto) => {
      setCreating(false);
      setResults((prev) => [p, ...prev]);
      setToast({ message: `${p.firstName} ${p.lastName} u shtua.`, tone: 'success' });
      window.setTimeout(() => setToast(null), 3000);
      // A doctor-created patient enters with all four required fields
      // (the create form gates the Save button on completeness), so
      // route straight to the chart.
      router.push(p.isComplete ? chartPath(p.id) : masterDataPath(p.id));
    },
    [router],
  );

  return (
    <main className="min-h-screen bg-stone-50">
      <DoctorPatientsTopNav />

      <section className="mx-auto grid max-w-6xl grid-cols-[340px_1fr] gap-6 px-8 py-8">
        <aside>
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-display text-[22px] font-semibold text-stone-900">
              Pacientët
            </h1>
            <Button size="sm" onClick={() => setCreating(true)}>
              + I ri
            </Button>
          </div>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l3 3" strokeLinecap="round" />
              </svg>
            </span>
            <Input
              placeholder="Kërko..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 h-9 text-[13.5px]"
              autoFocus
            />
          </div>

          <div className="mt-4 overflow-hidden rounded-lg border border-stone-200 bg-white">
            {error ? (
              <div className="px-4 py-3 text-[13px] text-amber-700">{error}</div>
            ) : loading ? (
              <div className="px-4 py-6 text-center text-[13px] text-stone-400">Po kërkohet…</div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-stone-500">
                {query.trim() ? `Asnjë rezultat.` : 'Shkruaj për të kërkuar.'}
              </div>
            ) : (
              <ul className="divide-y divide-stone-100">
                {results.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => openPatient(p)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-stone-50"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100 text-[12px] font-medium text-stone-700">
                        {patientInitials(p)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium text-stone-900">
                          {p.firstName} {p.lastName}
                        </div>
                        <div className="truncate text-[12px] text-stone-500">
                          {p.dateOfBirth ? formatDob(p.dateOfBirth) : 'DL pa caktuar'}
                          {p.dateOfBirth ? ` · ${ageLabel(p.dateOfBirth)}` : ''}
                        </div>
                      </div>
                      {!p.isComplete ? (
                        <span
                          className="ml-1 inline-flex h-5 items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                          title="Mungojnë të dhëna të detyrueshme"
                          aria-label="Të dhëna jo të plota"
                        >
                          Pa plotësuar
                        </span>
                      ) : p.alergjiTjera ? (
                        <span
                          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-[12px] font-semibold text-amber-700"
                          title="Alergji / Tjera"
                          aria-label="Ka alergji / shënim"
                        >
                          !
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        <section className="rounded-lg border border-stone-200 bg-white">
          {creating ? (
            <PatientFullForm
              key="new"
              mode="create"
              onSaved={handleCreated}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <div className="flex h-full min-h-[400px] items-center justify-center px-10 py-12 text-center text-[14px] text-stone-500">
              Zgjidh një pacient nga lista për të hapur kartelën,
              <br /> ose kliko „I ri” për të shtuar një pacient të ri.
            </div>
          )}
        </section>
      </section>

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

function DoctorPatientsTopNav() {
  const { me } = useMe();
  return <ClinicTopNav me={me} />;
}
