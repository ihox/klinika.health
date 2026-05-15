'use client';

import { useEffect, type ReactElement } from 'react';

interface Props {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation dialog for "Pastro vizitën" (Phase 2c). The action
 * wipes a today's completed visit's clinical fields and flips it back
 * to `arrived` so the doctor can re-enter the data. The doctor still
 * has a 15-second undo window via the toast that appears after
 * confirmation, but we ask up front because the action is destructive.
 *
 * Layout/copy matches the project's other small confirmation dialogs
 * (see set-sex-dialog.tsx for the visual lineage).
 */
export function ClearVisitDialog({
  open,
  busy = false,
  onConfirm,
  onClose,
}: Props): ReactElement | null {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-visit-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-[rgba(28,25,23,0.5)] p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-[440px] animate-modal-in rounded-lg border border-line bg-surface-elevated shadow-modal">
        <header className="border-b border-line-soft px-5 pb-3 pt-4">
          <h2
            id="clear-visit-title"
            className="m-0 font-display text-[16px] font-semibold tracking-snug text-ink-strong"
          >
            Pastro vizitën?
          </h2>
        </header>

        <div className="px-5 py-4 text-[13px] leading-relaxed text-ink-muted">
          Të gjitha të dhënat klinike do të fshihen. Mund ta anuloni
          këtë veprim brenda 15 sekondave.
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="clear-visit-cancel"
            className="inline-flex h-8 items-center rounded-sm border border-line bg-surface-elevated px-3 text-[12.5px] font-medium text-ink-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
          >
            Anulo
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="clear-visit-confirm"
            className="inline-flex h-8 items-center rounded-sm border border-transparent bg-warning px-3 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Duke pastruar…' : 'Po, pastro'}
          </button>
        </footer>
      </div>
    </div>
  );
}
