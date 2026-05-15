'use client';

import { useEffect, useState } from 'react';

interface NotificationToastProps {
  /** Bold first line of the toast (e.g. "Pacient i ri pa termin: Liam"). */
  message: string;
  /** Optional dim second line. */
  secondary?: string;
  /** Called when the user clicks dismiss OR the auto-dismiss timer fires. */
  onDismiss: () => void;
  /** Auto-dismiss window. Defaults to 8 s — Phase 2b walk-in arrival. */
  durationMs?: number;
}

/**
 * Anchored bottom-right notification toast.
 *
 * Different from `UndoToast` (centred, dark pill, 30 s) — this one is a
 * light card with a teal accent border, slides in from the right, and
 * auto-dismisses on a shorter window. Used by the doctor's home to
 * surface a walk-in arrival initiated by the receptionist.
 */
export function NotificationToast({
  message,
  secondary,
  onDismiss,
  durationMs = 8_000,
}: NotificationToastProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [onDismiss, durationMs]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="walkin-notification"
      className={[
        'fixed bottom-6 right-6 z-[120] overflow-hidden rounded-md',
        'min-w-[280px] max-w-[360px] border-l-[3px] border-l-primary',
        'border border-line bg-surface-elevated shadow-modal',
        'transition-[transform,opacity] duration-[240ms] ease-[cubic-bezier(.2,.7,.3,1)]',
        mounted ? 'translate-x-0 opacity-100' : 'translate-x-[120%] opacity-0',
      ].join(' ')}
    >
      <div className="flex items-start gap-3 px-3.5 pb-3 pt-3">
        <div
          aria-hidden
          className="mt-px grid h-6 w-6 shrink-0 place-items-center rounded border border-teal-200 bg-primary-soft text-primary-dark"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8a5 5 0 0 1 8.5-3.5L13 6" />
            <path d="M13 2.5V6h-3.5" />
          </svg>
        </div>
        <div className="flex-1 leading-snug">
          <div className="text-[13px] font-semibold text-ink-strong">
            {message}
          </div>
          {secondary ? (
            <div className="mt-0.5 text-[11.5px] text-ink-muted">
              {secondary}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Mbyll njoftimin"
          className="-mr-1 -mt-0.5 rounded p-1 text-ink-faint transition hover:bg-surface-subtle hover:text-ink"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <div
        aria-hidden
        className="h-[2px] origin-left bg-primary/40"
        style={{ animation: `walkin-toast-drain ${durationMs}ms linear forwards` }}
      />
      <style>{`
        @keyframes walkin-toast-drain {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}
