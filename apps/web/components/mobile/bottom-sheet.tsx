'use client';

import * as React from 'react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { NavIcon } from './nav-icon';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Sheet heading (rendered in the grab-handle header). */
  title: string;
  children: ReactNode;
  /** Max sheet height as a % of the viewport. */
  maxHeightPct?: number;
  /** Extra content rendered in the header row, right of the title
   *  (before the close button) — e.g. a count. */
  headerAdjacent?: ReactNode;
  /** Override the scrollable body wrapper; when false the caller owns the
   *  body region (used by the search sheet's pinned input). */
  scrollBody?: boolean;
  'data-testid'?: string;
}

/**
 * iOS-style bottom sheet (handoff spec §6): rounded top, grab handle,
 * scrim, transform-based slide (320ms). Dismiss via the scrim, the close
 * button, or Escape. Always mounted (portal'd to <body>) and toggled via
 * `data-open` so both the enter and exit transitions play; the slide
 * transforms + reduced-motion guard live in mobile.css (`.m-sheet` /
 * `.m-scrim`).
 *
 * Below-desktop only (`xl:hidden`): the search sheet is reachable on both
 * phone and tablet (handoff spec §4); the overflow sheet's only trigger is
 * the phone bottom-tab bar, so it never opens above phone width regardless.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeightPct = 88,
  headerAdjacent,
  scrollBody = true,
  'data-testid': testId,
}: BottomSheetProps) {
  const [mounted, setMounted] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  // Escape closes; lock background scroll while open.
  useEffect(() => {
    if (!open) return undefined;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] xl:hidden"
      style={{ pointerEvents: open ? 'auto' : 'none' }}
      aria-hidden={open ? undefined : true}
    >
      <div
        className="m-scrim absolute inset-0 bg-[rgba(28,25,23,0.42)]"
        data-open={open ? 'true' : 'false'}
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-open={open ? 'true' : 'false'}
        data-testid={testId}
        className="m-sheet absolute inset-x-0 bottom-0 flex flex-col rounded-t-[var(--m-sheet-radius)] bg-surface-elevated shadow-[0_-16px_48px_rgba(28,25,23,0.22)]"
        style={{
          maxHeight: `${maxHeightPct}%`,
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div
          className="mx-auto mt-2 h-[5px] w-10 shrink-0 rounded-full bg-line-strong"
          aria-hidden="true"
        />
        <div className="flex items-center justify-between gap-2 px-[var(--m-gutter)] pb-2.5 pt-1.5">
          <h3 className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink-strong">
            {title}
          </h3>
          <div className="flex items-center gap-1">
            {headerAdjacent}
            <button
              type="button"
              onClick={onClose}
              aria-label="Mbyll"
              className="grid h-11 w-11 -mr-2 place-items-center rounded-full text-ink-muted transition active:bg-surface-muted [-webkit-tap-highlight-color:transparent]"
            >
              <NavIcon name="close" size={20} />
            </button>
          </div>
        </div>
        {scrollBody ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [-webkit-overflow-scrolling:touch]">
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  );
}
