'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import {
  formatDob,
  patientClient,
  type PatientPublicDto,
} from '@/lib/patient-client';

interface Props {
  open: boolean;
  /** Optional initial query string — used to pre-fill the first name. */
  seed?: string;
  onClose: () => void;
  onCreated: (patient: PatientPublicDto) => void;
  onError?: (message: string) => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

/**
 * Receptionist quick-add: three fields, no PHI.
 *
 * The soft-duplicate notice (per the locked design decision) is
 * informational — it surfaces likely matches as the user types but
 * NEVER blocks creation. Two affordances: "Use existing" selects the
 * candidate and dismisses, "Continue as new" submits anyway.
 */
export function QuickAddPatientModal({
  open,
  seed = '',
  onClose,
  onCreated,
  onError,
}: Props) {
  const [form, setForm] = useState<FormState>({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
  });
  const [candidates, setCandidates] = useState<PatientPublicDto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [touchedDuplicates, setTouchedDuplicates] = useState(false);

  // Pre-fill the first name with the search-box query, splitting on
  // whitespace so "Rita Hoxha" lands in both fields.
  useEffect(() => {
    if (!open) return;
    const parts = seed.trim().split(/\s+/);
    setForm({
      firstName: parts[0] ?? '',
      lastName: parts.slice(1).join(' '),
      dateOfBirth: '',
    });
    setCandidates([]);
    setTouchedDuplicates(false);
  }, [open, seed]);

  // Soft-duplicate probe — debounced, fires once both name fields have
  // content. Never blocking.
  useEffect(() => {
    if (!open) return;
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) {
      setCandidates([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      try {
        const res = await patientClient.duplicateCheck({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth || undefined,
        });
        setCandidates(res.candidates);
        setTouchedDuplicates(true);
      } catch {
        // Silent — duplicate check is best-effort, never blocks UI.
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [open, form]);

  const submit = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (submitting) return;
      if (!form.firstName.trim() || !form.lastName.trim()) return;
      setSubmitting(true);
      try {
        const res = await patientClient.createMinimal({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          dateOfBirth: form.dateOfBirth || undefined,
        });
        onCreated(res.patient);
      } catch (err) {
        const message =
          err instanceof ApiError ? err.body.message ?? err.message : 'Nuk u krijua.';
        onError?.(message);
      } finally {
        setSubmitting(false);
      }
    },
    [form, onCreated, onError, submitting],
  );

  // Esc to dismiss.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canSubmit =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    !submitting;

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-stone-900/40 px-4 pt-20"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quickAddTitle"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-stone-200 bg-white shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-stone-100 px-5 py-3.5">
          <h2 id="quickAddTitle" className="text-[16px] font-semibold text-stone-900">
            Pacient i ri
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-stone-400 hover:text-stone-700"
            aria-label="Mbyll"
          >
            ×
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-stone-500">
                Emri
              </span>
              <Input
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                autoComplete="off"
                autoFocus
                maxLength={80}
                aria-label="Emri"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-stone-500">
                Mbiemri
              </span>
              <Input
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                autoComplete="off"
                maxLength={80}
                aria-label="Mbiemri"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-stone-500">
              Datelindja <span className="text-stone-400 normal-case">(opsionale)</span>
            </span>
            <Input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
              max={new Date().toISOString().slice(0, 10)}
              aria-label="Datelindja"
            />
          </label>

          <p className="text-[12.5px] text-stone-500">
            Mjeku do t&apos;i plotësojë të dhënat e tjera në vizitën e parë.
          </p>

          {touchedDuplicates && candidates.length > 0 ? (
            <DuplicateNotice
              candidates={candidates}
              onUseExisting={(p) => {
                onCreated(p);
              }}
            />
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-stone-100 px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Anulo
          </Button>
          <Button type="submit" variant="primary" disabled={!canSubmit}>
            {candidates.length > 0 ? 'Vazhdo si i ri' : 'Ruaj pacientin'}
          </Button>
        </footer>
      </form>
    </div>
  );
}

function DuplicateNotice({
  candidates,
  onUseExisting,
}: {
  candidates: PatientPublicDto[];
  onUseExisting: (p: PatientPublicDto) => void;
}) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2.5 text-[13px]">
      <div className="font-medium text-amber-900">Mund të ekzistojë tashmë:</div>
      <ul className="mt-1.5 space-y-1">
        {candidates.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-2">
            <span className="text-stone-800">
              {c.firstName} {c.lastName}
              {c.dateOfBirth ? ` · ${formatDob(c.dateOfBirth)}` : ''}
            </span>
            <button
              type="button"
              onClick={() => onUseExisting(c)}
              className="text-[12.5px] font-medium text-teal-700 hover:underline"
            >
              Përdor këtë
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 text-[12.5px] text-amber-900/80">
        Ose vazhdo për të krijuar një të ri.
      </div>
    </div>
  );
}
