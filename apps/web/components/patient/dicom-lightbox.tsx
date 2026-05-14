'use client';

import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
} from 'react';

import { ApiError } from '@/lib/api';
import {
  dicomClient,
  dicomPreviewUrl,
  type DicomInstanceDto,
  type DicomStudyDetailDto,
} from '@/lib/dicom-client';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  studyId: string;
  /** Patient first+last for the top-left muted meta. */
  patientName: string;
  /** Visit date ISO (YYYY-MM-DD) for the subline. */
  visitDateIso: string;
  onClose: () => void;
}

/**
 * Full-screen DICOM lightbox — translates
 * `design-reference/prototype/components/dicom-lightbox.html`.
 *
 * Flow:
 *   1. Click a linked-study thumbnail in the chart's Ultrazeri panel.
 *   2. GET /api/dicom/studies/:id returns the ordered instance list.
 *   3. The viewer renders the active instance via the authenticated
 *      image proxy (/api/dicom/instances/:id/preview.png) and lets the
 *      doctor step through the strip with ◀ ▶ or arrow keys.
 *   4. Each instance fetched writes a `dicom.instance.viewed` audit row.
 *
 * Keyboard:
 *   ← / →   step instance
 *   1 / 2   set zoom
 *   Esc     close
 */
export function DicomLightbox({
  open,
  studyId,
  patientName,
  visitDateIso,
  onClose,
}: Props): ReactElement | null {
  const [study, setStudy] = useState<DicomStudyDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<1 | 2>(1);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStudy(null);
    setError(null);
    setIndex(0);
    setZoom(1);
    (async () => {
      try {
        const res = await dicomClient.studyDetail(studyId);
        if (!cancelled) setStudy(res.study);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message || 'Studimi nuk u ngarkua.'
            : 'Studimi nuk u ngarkua.';
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, studyId]);

  const total = study?.instances.length ?? 0;

  const step = useCallback(
    (delta: number) => {
      if (total <= 1) return;
      setIndex((i) => {
        let next = i + delta;
        if (next < 0) next = total - 1;
        if (next >= total) next = 0;
        return next;
      });
    },
    [total],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === '1') setZoom(1);
      else if (e.key === '2') setZoom(2);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, step]);

  if (!open) return null;

  const visitDate = formatVisitDate(visitDateIso);
  const description = study?.studyDescription;
  const subline = description
    ? `Vizita e ${visitDate} · ${description}`
    : `Vizita e ${visitDate} · Ultrazeri`;

  const active: DicomInstanceDto | null = study?.instances[index] ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pamja e imazheve DICOM"
      data-testid="dicom-lightbox"
      data-zoom={zoom}
      data-count={total}
      className="fixed inset-0 z-modal grid place-items-center overflow-hidden"
      style={{ background: '#0c0a09' }}
    >
      {/* Top bar — patient meta + zoom toggle + close */}
      <div
        className="fixed inset-x-0 top-0 z-10 flex items-center justify-between px-5 py-4"
        style={{
          background: 'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, transparent 100%)',
          color: 'white',
        }}
      >
        <div className="text-[12px] leading-snug">
          <div
            className="text-[13px] font-medium text-white"
            data-testid="dicom-lightbox-patient"
          >
            {patientName}
          </div>
          <div className="font-mono text-[11px] tabular-nums text-white/50">
            {subline}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Zoom"
            className="flex overflow-hidden rounded-md font-mono text-[11px]"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <button
              type="button"
              data-testid="dicom-lightbox-zoom-1"
              onClick={() => setZoom(1)}
              aria-pressed={zoom === 1}
              className={cn(
                'px-3.5 py-2 transition',
                zoom === 1
                  ? 'font-semibold text-white'
                  : 'text-white/65 hover:bg-white/10',
              )}
              style={zoom === 1 ? { background: 'rgba(255,255,255,0.18)' } : undefined}
            >
              1×
            </button>
            <button
              type="button"
              data-testid="dicom-lightbox-zoom-2"
              onClick={() => setZoom(2)}
              aria-pressed={zoom === 2}
              className={cn(
                'px-3.5 py-2 transition',
                zoom === 2
                  ? 'font-semibold text-white'
                  : 'text-white/65 hover:bg-white/10',
              )}
              style={zoom === 2 ? { background: 'rgba(255,255,255,0.18)' } : undefined}
            >
              2×
            </button>
          </div>
          <button
            type="button"
            data-testid="dicom-lightbox-close"
            onClick={onClose}
            aria-label="Mbyll (Esc)"
            title="Mbyll (Esc)"
            className="grid h-[34px] w-[34px] place-items-center rounded-md text-white/85 transition hover:bg-white/15"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </button>
        </div>
      </div>

      {/* Left arrow — only meaningful for multi-image studies */}
      {total > 1 ? (
        <button
          type="button"
          aria-label="I mëparshmi (←)"
          data-testid="dicom-lightbox-prev"
          onClick={() => step(-1)}
          className="fixed left-6 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-pill border text-white/85 transition hover:bg-white/15"
          style={{
            background: 'rgba(255,255,255,0.08)',
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M11 3L5 9l6 6" />
          </svg>
        </button>
      ) : null}

      {/* Image stage */}
      <div className="fixed inset-0 grid place-items-center">
        {error ? (
          <p
            role="alert"
            className="rounded-md px-4 py-3 text-[13px] text-white/85"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            {error}
          </p>
        ) : !study ? (
          <div
            aria-hidden
            className="h-[60vh] w-[60vh] max-h-[70vw] max-w-[70vw] animate-pulse"
            style={{ background: 'rgba(255,255,255,0.04)' }}
          />
        ) : total === 0 ? (
          <p
            role="status"
            className="rounded-md px-4 py-3 text-[13px] text-white/85"
            style={{ background: 'rgba(255,255,255,0.06)' }}
          >
            Studimi nuk ka imazhe të ngarkuara.
          </p>
        ) : active ? (
          /* The native <img> goes through the authenticated proxy.
             We use a key on the `src` to force a fresh fetch when the
             doctor steps, otherwise the browser would keep showing the
             previous frame during the network round-trip. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={active.id}
            src={dicomPreviewUrl(active.id)}
            alt={`Imazh ${index + 1} nga ${total}`}
            data-testid="dicom-lightbox-image"
            crossOrigin="use-credentials"
            className="block aspect-square max-h-[80vh] max-w-[80vw] object-contain transition-transform duration-200"
            style={{
              transform: zoom === 2 ? 'scale(2)' : 'scale(1)',
              width: 'min(70vw, 70vh)',
              height: 'min(70vw, 70vh)',
            }}
          />
        ) : null}
      </div>

      {/* Right arrow */}
      {total > 1 ? (
        <button
          type="button"
          aria-label="I tjetri (→)"
          data-testid="dicom-lightbox-next"
          onClick={() => step(1)}
          className="fixed right-6 top-1/2 z-10 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-pill border text-white/85 transition hover:bg-white/15"
          style={{
            background: 'rgba(255,255,255,0.08)',
            borderColor: 'rgba(255,255,255,0.12)',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M7 3l6 6-6 6" />
          </svg>
        </button>
      ) : null}

      {/* Counter pill */}
      {total > 0 ? (
        <div
          className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-center gap-4 px-6 py-5"
          style={{
            background: 'linear-gradient(0deg, rgba(0,0,0,0.55) 0%, transparent 100%)',
          }}
        >
          <span
            data-testid="dicom-lightbox-counter"
            className="rounded-pill px-3.5 py-1.5 font-mono text-[12px] tabular-nums text-white/80"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            {index + 1} <span className="text-white/50">/ {total}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatVisitDate(iso: string): string {
  const [date] = iso.split('T');
  const [y, m, d] = (date ?? '').split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}
