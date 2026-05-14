'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { useAutoSaveStore } from '@/lib/use-visit-autosave';
import type { VisitFormValues } from '@/lib/visit-client';
import { writeBackup } from '@/lib/visit-backup';

const FIELD_LABELS: Record<keyof VisitFormValues, string> = {
  visitDate: 'Data e vizitës',
  complaint: 'Ankesa',
  feedingNotes: 'Shënim për ushqimin',
  feedingBreast: 'Gji',
  feedingFormula: 'Formulë',
  feedingSolid: 'Solid',
  weightKg: 'Pesha',
  heightCm: 'Gjatësia',
  headCircumferenceCm: 'Perimetri i kokës',
  temperatureC: 'Temperatura',
  paymentCode: 'Pagesa',
  examinations: 'Ekzaminime',
  ultrasoundNotes: 'Ultrazeri',
  legacyDiagnosis: 'Diagnoza (tekst)',
  prescription: 'Terapia',
  labResults: 'Analizat',
  followupNotes: 'Kontrolla',
  otherNotes: 'Tjera',
  diagnoses: 'Diagnoza · ICD-10',
};

/**
 * Modal shown when an auto-save PATCH fails. Mirrors
 * design-reference/prototype/components/save-failure-dialog.html:
 *   * warning header
 *   * list of unsaved fields (with current values for the doctor to
 *     copy out manually if needed)
 *   * help line saying "the data is saved on this device, you can
 *     close the page"
 *   * three actions: Mbyll · Ruaj lokalisht · Provo përsëri
 *
 * Three success states:
 *   * "U ruajtën lokalisht" — IndexedDB write succeeded after the
 *     server-side save failed.
 *   * "Ndryshimet u ruajtën" — retry succeeded.
 *   * Closed dialog — user dismissed without retrying. The error
 *     pill stays in the action bar so the warning is never hidden
 *     from the doctor.
 */
export function SaveFailureDialog(): ReactElement | null {
  const open = useAutoSaveStore((s) => s.failureDialogOpen);
  const unsavedFields = useAutoSaveStore((s) => s.unsavedFields);
  const values = useAutoSaveStore((s) => s.values);
  const visitId = useAutoSaveStore((s) => s.visitId);
  const retry = useAutoSaveStore((s) => s.retry);
  const dismiss = useAutoSaveStore((s) => s.dismissDialog);

  const [confirm, setConfirm] = useState<'retry-ok' | 'saved-local' | null>(null);

  useEffect(() => {
    if (!open) setConfirm(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismiss]);

  if (!open || !values) return null;

  const handleRetry = async (): Promise<void> => {
    await retry();
    const state = useAutoSaveStore.getState();
    if (state.state !== 'error') {
      setConfirm('retry-ok');
      window.setTimeout(() => dismiss(), 1200);
    }
  };

  const handleSaveLocal = async (): Promise<void> => {
    if (visitId && values) {
      await writeBackup(visitId, values);
    }
    setConfirm('saved-local');
    window.setTimeout(() => dismiss(), 1500);
  };

  if (confirm === 'retry-ok' || confirm === 'saved-local') {
    return (
      <div className="fixed inset-0 z-modal grid place-items-center bg-black/40 px-4 py-10 backdrop-blur-[3px]">
        <div className="w-full max-w-[420px] rounded-xl border border-line bg-surface-elevated px-6 py-8 text-center shadow-modal animate-modal-in">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-success-soft bg-success-bg text-success">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12.5l4.5 4.5L20 7" />
            </svg>
          </div>
          <h3 className="mt-3 text-[16px] font-semibold text-ink-strong">
            {confirm === 'retry-ok' ? 'Ndryshimet u ruajtën' : 'U ruajtën lokalisht'}
          </h3>
          <p className="mt-1 text-[13px] text-ink-muted">
            {confirm === 'retry-ok'
              ? 'Mund të vazhdoni punën.'
              : 'Sapo lidhja të kthehet, rikuperohen automatikisht.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
      className="fixed inset-0 z-modal grid place-items-center bg-black/40 px-4 py-10 backdrop-blur-[3px]"
    >
      <div
        role="alertdialog"
        aria-labelledby="save-failure-title"
        className="w-full max-w-[520px] overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-modal animate-modal-in"
      >
        <header className="flex items-start gap-3 px-6 pb-3 pt-5">
          <div
            aria-hidden
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-warning-soft bg-warning-bg text-warning"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 2.5l7 12H2z" />
              <path d="M9 7.5v3.5M9 12.6v.01" />
            </svg>
          </div>
          <div>
            <h3
              id="save-failure-title"
              className="text-[16px] font-semibold text-ink-strong"
            >
              Ruajtja dështoi
            </h3>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">
              Ndryshimet nuk u ruajtën. Provoni përsëri ose ruajini lokalisht.
            </p>
          </div>
        </header>

        <div className="px-6 pb-4 pt-1">
          <div className="overflow-hidden rounded-md border border-line">
            <div className="border-b border-line bg-surface-subtle px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              Fusha të paruajtura · {unsavedFields.length}
            </div>
            <ul>
              {unsavedFields.length === 0 ? (
                <li className="px-3 py-3 text-[12.5px] italic text-ink-muted">
                  Asnjë ndryshim i mbetur.
                </li>
              ) : (
                unsavedFields.map((field) => (
                  <li
                    key={field}
                    className="grid grid-cols-[100px_1fr] gap-2.5 border-t border-line-soft px-3 py-2.5 first:border-t-0"
                  >
                    <div className="text-[10.5px] font-medium uppercase tracking-[0.04em] text-ink-muted">
                      {FIELD_LABELS[field as keyof VisitFormValues] ?? field}
                    </div>
                    <div className="break-words text-[12.5px] text-ink">
                      {previewValue(values, field as keyof VisitFormValues)}
                    </div>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="mt-3 grid grid-cols-[14px_1fr] items-start gap-2 rounded-md bg-surface-subtle px-3 py-2.5 text-[12px] leading-snug text-ink-muted">
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-[2px] text-primary"
              aria-hidden
            >
              <circle cx="7" cy="7" r="5.5" />
              <path d="M7 4v3.5l2 1.2" />
            </svg>
            <span>
              Të dhënat janë ruajtur përkohësisht në pajisjen tuaj. Mund të mbyllni
              faqen — rikuperohen kur lidhja kthehet.
            </span>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-subtle px-6 py-3">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Mbyll
          </Button>
          <Button variant="secondary" size="sm" onClick={handleSaveLocal}>
            Ruaj lokalisht
          </Button>
          <Button variant="primary" size="sm" onClick={handleRetry}>
            Provo përsëri
          </Button>
        </footer>
      </div>
    </div>
  );
}

function previewValue(values: VisitFormValues, key: keyof VisitFormValues): string {
  const raw = values[key];
  if (typeof raw === 'boolean') return raw ? 'Po' : 'Jo';
  if (Array.isArray(raw)) {
    if (raw.length === 0) return '— bosh —';
    return raw.map((d) => `${d.code} ${d.latinDescription}`).join(' · ');
  }
  if (raw == null || raw === '') return '— bosh —';
  return String(raw);
}
