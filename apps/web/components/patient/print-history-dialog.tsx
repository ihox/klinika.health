'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { openPrintFrame } from '@/lib/print-frame';
import type { PatientFullDto } from '@/lib/patient-client';
import { printUrls } from '@/lib/vertetim-client';

interface Props {
  open: boolean;
  patient: PatientFullDto;
  /** How many DICOM studies are linked to this patient. 0 hides the toggle. */
  ultrasoundImageCount?: number;
  onClose: () => void;
}

/**
 * Compact dialog confirming the patient-history print job.
 *
 * The doctor sees the patient name + a single toggle ("Imazhet e
 * ultrazerit") that controls whether the optional appendix renders.
 * Clicking "Printo" issues the GET request, embeds the resulting PDF
 * in the hidden iframe, and triggers the browser's print dialog.
 */
export function PrintHistoryDialog({
  open,
  patient,
  ultrasoundImageCount = 0,
  onClose,
}: Props): ReactElement | null {
  const [includeUs, setIncludeUs] = useState(false);

  useEffect(() => {
    if (open) setIncludeUs(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = (): void => {
    openPrintFrame({
      src: printUrls.history(patient.id, includeUs && ultrasoundImageCount > 0),
    });
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="print-history-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-[rgba(28,25,23,0.38)] p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[440px] animate-modal-in overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-modal">
        <header className="border-b border-line px-5 pb-3 pt-4">
          <h3
            id="print-history-title"
            className="m-0 font-display text-[16px] font-semibold text-ink-strong"
          >
            Printo historinë e pacientit
          </h3>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {patient.firstName} {patient.lastName}
          </p>
        </header>

        <div className="flex flex-col gap-3 px-5 py-4">
          <p className="text-[13px] text-ink">
            Të gjitha vizitat printohen me datë, peshë, diagnozë dhe terapi.
          </p>

          {ultrasoundImageCount > 0 ? (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface-subtle px-3 py-2 text-[13px] text-ink-muted hover:bg-surface-elevated">
              <input
                type="checkbox"
                checked={includeUs}
                onChange={(e) => setIncludeUs(e.target.checked)}
                className="h-4 w-4 accent-teal-600"
                data-testid="print-history-ultrasound-toggle"
              />
              Imazhet e ultrazerit{' '}
              <span className="text-ink-faint">
                ({ultrasoundImageCount} imazhe)
              </span>
            </label>
          ) : (
            <p className="text-[11.5px] italic text-ink-faint">
              Nuk ka imazhe të ultrazërit për këtë pacient.
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-md px-3 text-[13px] text-ink hover:bg-surface-elevated"
          >
            Anulo
          </button>
          <button
            type="button"
            onClick={submit}
            data-testid="print-history-confirm"
            className="inline-flex h-9 items-center rounded-md border border-transparent bg-primary px-3 text-[13px] font-medium text-white shadow-xs hover:bg-primary-dark"
          >
            Printo
          </button>
        </footer>
      </div>
    </div>
  );
}
