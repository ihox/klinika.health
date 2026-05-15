'use client';

import { useEffect, useRef, useState, type ReactElement } from 'react';

const REASON_MAX_LENGTH = 150;

interface Props {
  open: boolean;
  busy?: boolean;
  /** Called with the user-typed reason (already trimmed; empty when blank). */
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

/**
 * Confirmation dialog for "Fshij vizitën". The deletion is reversible
 * via the 30-second undo toast that surfaces after confirm, so this
 * dialog is intentionally light — its main job is to capture an
 * optional "Pse?" reason that rides into the audit log.
 *
 * The reason is opt-in: doctors who just want to delete a duplicate
 * row in a hurry should be able to hit Enter on the confirm button
 * without typing anything. The data habit gets built incrementally —
 * if the field stays empty, the audit log records the deletion
 * without a reason.
 */
export function DeleteVisitDialog({
  open,
  busy = false,
  onConfirm,
  onClose,
}: Props): ReactElement | null {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the field every time the dialog opens. Without this, a doctor
  // who cancelled the dialog with a half-typed reason would see it
  // restored on the next open — surprising behaviour for a destructive
  // confirmation.
  useEffect(() => {
    if (open) {
      setReason('');
      // Focus the input after the next paint so the keyboard goes to
      // the right place and the Cancel button doesn't steal it via
      // initial autofocus heuristics.
      const id = window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const handleConfirm = (): void => {
    if (busy) return;
    onConfirm(reason.trim());
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-visit-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-[rgba(28,25,23,0.5)] p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="w-full max-w-[460px] animate-modal-in rounded-lg border border-line bg-surface-elevated shadow-modal">
        <header className="border-b border-line-soft px-5 pb-3 pt-4">
          <h2
            id="delete-visit-title"
            className="m-0 font-display text-[16px] font-semibold tracking-snug text-ink-strong"
          >
            Fshij vizitën?
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Vizita do të fshihet. Mund ta anuloni brenda 30 sekondave.
          </p>
        </header>

        <div className="px-5 pb-4 pt-3">
          <label
            htmlFor="delete-visit-reason"
            className="mb-1.5 block text-[12px] font-medium text-ink-muted"
          >
            Pse? <span className="font-normal text-ink-faint">(opcionale)</span>
          </label>
          <input
            ref={inputRef}
            id="delete-visit-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, REASON_MAX_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !busy) handleConfirm();
            }}
            maxLength={REASON_MAX_LENGTH}
            placeholder="P.sh. pacienti u regjistrua dy herë"
            data-testid="delete-visit-reason"
            className="w-full rounded-md border border-line-strong bg-surface-elevated px-3 py-2 text-[13px] text-ink outline-none focus:border-primary focus:shadow-focus"
            disabled={busy}
          />
          <p className="mt-1.5 text-[11.5px] text-ink-faint">
            Ndihmon në mbajtjen e gjurmës së ndryshimeve.
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            data-testid="delete-visit-cancel"
            className="inline-flex h-8 items-center rounded-sm border border-line bg-surface-elevated px-3 text-[12.5px] font-medium text-ink-strong hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-60"
          >
            Anulo
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            data-testid="delete-visit-confirm"
            className="inline-flex h-8 items-center rounded-sm border border-transparent bg-danger px-3 text-[12.5px] font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Duke fshirë…' : 'Po, fshij'}
          </button>
        </footer>
      </div>
    </div>
  );
}
