'use client';

import { useEffect, useState } from 'react';

interface UndoToastProps {
  /** Main line, e.g. "Termini u fshi." */
  message: string;
  /** Optional dim line below, e.g. "Eriona Krasniqi · 14:30". */
  secondary?: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** Auto-dismiss window in ms. Default 30_000 per CLAUDE.md §5.5. */
  durationMs?: number;
}

/**
 * Soft-delete undo toast — mirrors
 * design-reference/prototype/components/toast-undo.html exactly: dark
 * pill anchored bottom-center, trash icon on the left, main + dim
 * lines, white-text "Anulo" button on the right, and a 30s draining
 * countdown bar at the bottom. Slides up on enter, slides down on
 * dismiss.
 */
export function UndoToast({
  message,
  secondary,
  onUndo,
  onDismiss,
  durationMs = 30_000,
}: UndoToastProps) {
  // `mounted` flips to true on the next tick so the entrance transition
  // animates instead of starting in the final state.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 overflow-hidden rounded-lg',
        'min-w-[360px] px-3.5 pt-3 text-[13px] text-white shadow-modal backdrop-blur-sm',
        'bg-[rgba(12,10,9,0.92)]',
        'transition-[transform,opacity] duration-[280ms] ease-[cubic-bezier(.2,.7,.3,1)]',
        mounted ? 'translate-y-0 opacity-100' : 'translate-y-[120px] opacity-0',
      ].join(' ')}
      style={{ transform: `translateX(-50%) translateY(${mounted ? '0' : '120px'})` }}
    >
      <div className="flex items-center gap-4 pb-[11px]">
        <div
          aria-hidden="true"
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-white/10 text-white/70"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4h8M5 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M4.5 4l.5 7a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1l.5-7" />
          </svg>
        </div>
        <div className="flex-1 leading-snug">
          <div className="font-medium">{message}</div>
          {secondary ? (
            <div className="mt-px text-[11.5px] text-white/55">{secondary}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => {
            onUndo();
            onDismiss();
          }}
          className="rounded-sm border border-white/[0.18] bg-transparent px-3 py-1 text-[13px] font-semibold text-white transition hover:bg-white/10"
        >
          Anulo
        </button>
      </div>
      <div
        aria-hidden="true"
        className="h-[2px] origin-left bg-white/60"
        style={{ animation: `undo-drain ${durationMs}ms linear forwards` }}
      />
      <style>{`
        @keyframes undo-drain {
          from { transform: scaleX(1); }
          to   { transform: scaleX(0); }
        }
      `}</style>
    </div>
  );
}
