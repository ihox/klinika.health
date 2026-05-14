'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { ApiError } from '@/lib/api';
import { dicomClient, type DicomLinkDto, type DicomStudyDto } from '@/lib/dicom-client';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  visitId: string;
  /** Patient first+last for the picker subtitle ("vizita e dd.mm.yyyy"). */
  patientName: string;
  visitDateIso: string;
  /** Ids already linked to this visit — disabled in the list. */
  alreadyLinkedStudyIds: ReadonlySet<string>;
  onClose: () => void;
  /** Fired when a study is successfully linked; chart refreshes its panel. */
  onLinked: (link: DicomLinkDto) => void;
}

/**
 * "Lidh studim ultrazeri" modal — translates
 * `design-reference/prototype/components/dicom-picker.html`.
 *
 * Flow:
 *   1. Open from the chart's Ultrazeri panel.
 *   2. Fetch the last 10 studies received by Orthanc (most-recent first).
 *   3. Doctor clicks a card; `Lidh me këtë vizitë` enables.
 *   4. POST creates a visit_dicom_links row; modal closes; chart refreshes.
 *
 * Studies already linked to the current visit are still listed (so the
 * doctor sees what they're working with) but their card is disabled.
 *
 * Manual picker only — MWL (worklist-driven auto-attach) ships in v2.
 */
export function DicomPickerDialog({
  open,
  visitId,
  patientName,
  visitDateIso,
  alreadyLinkedStudyIds,
  onClose,
  onLinked,
}: Props): ReactElement | null {
  const [studies, setStudies] = useState<DicomStudyDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch the picker source list on open. Re-fetch on every open so a
  // study that just landed shows up without a page reload.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStudies(null);
    setSelectedId(null);
    setError(null);
    (async () => {
      try {
        const res = await dicomClient.recent();
        if (!cancelled) setStudies(res.studies);
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message || 'Lista nuk u ngarkua. Provoni përsëri.'
            : 'Lista nuk u ngarkua. Provoni përsëri.';
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const visitDate = formatDdMmYyyy(visitDateIso);
  const subtitle = `${patientName} · vizita e ${visitDate} · zgjidh studimin që i përket kësaj vizite.`;

  async function link(): Promise<void> {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await dicomClient.linkStudy(visitId, selectedId);
      onLinked(res.link);
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message || 'Lidhja dështoi. Provoni përsëri.'
          : 'Lidhja dështoi. Provoni përsëri.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dicom-picker-title"
      className="fixed inset-0 z-modal grid place-items-center bg-[rgba(28,25,23,0.38)] p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[560px] animate-modal-in overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-modal">
        <header className="border-b border-line px-6 pb-3.5 pt-4">
          <h3
            id="dicom-picker-title"
            className="m-0 font-display text-[16px] font-semibold text-ink-strong"
          >
            Lidh studim ultrazeri
          </h3>
          <p className="mt-1 text-[12.5px] text-ink-muted" data-testid="dicom-picker-subtitle">
            {subtitle}
          </p>
        </header>

        <div className="flex max-h-[440px] flex-col gap-2 overflow-y-auto px-4 pb-4 pt-3">
          {studies == null ? (
            <PickerLoading />
          ) : studies.length === 0 ? (
            <EmptyList />
          ) : (
            studies.map((s, idx) => {
              const alreadyLinked = alreadyLinkedStudyIds.has(s.id);
              return (
                <StudyCard
                  key={s.id}
                  study={s}
                  variantIndex={idx}
                  selected={selectedId === s.id}
                  disabled={alreadyLinked}
                  onSelect={() => !alreadyLinked && setSelectedId(s.id)}
                />
              );
            })
          )}
          {error ? (
            <p
              role="alert"
              className="rounded-sm border border-danger-soft bg-danger-bg px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2.5 border-t border-line bg-surface-subtle px-5 py-3">
          <span className="mr-auto text-[11.5px] text-ink-faint" data-testid="dicom-picker-footer-stat">
            {selectedId
              ? '1 i zgjedhur'
              : studies
                ? `${studies.length} studime të fundit`
                : ''}
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-9 items-center rounded-md px-3 text-[13px] text-ink hover:bg-surface-elevated disabled:opacity-60"
          >
            Anulo
          </button>
          <button
            type="button"
            data-testid="dicom-picker-link"
            onClick={() => void link()}
            disabled={!selectedId || busy}
            className="inline-flex h-9 items-center rounded-md border border-transparent bg-primary px-3 text-[13px] font-medium text-white shadow-xs hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Duke lidhur…' : 'Lidh me këtë vizitë'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// =========================================================================
// Study card
// =========================================================================

interface StudyCardProps {
  study: DicomStudyDto;
  variantIndex: number;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function StudyCard({ study, variantIndex, selected, disabled, onSelect }: StudyCardProps): ReactElement {
  const when = formatDateTime(study.receivedAt);
  const relative = useRelativeWhenLabel(study.receivedAt);
  const thumbCount = Math.min(4, study.imageCount);
  const shortId = `…${study.orthancStudyId.slice(-7)}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      data-testid={`dicom-picker-card-${study.id}`}
      aria-pressed={selected}
      className={cn(
        'grid w-full grid-cols-[auto_1fr_auto] items-center gap-3.5 rounded-md border bg-surface-elevated px-3 py-2.5 text-left transition',
        selected
          ? 'border-primary bg-primary-tint shadow-[0_0_0_1px_var(--tw-shadow-color)] shadow-primary'
          : 'border-line',
        !disabled && !selected && 'hover:border-line-strong hover:bg-surface-subtle',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <div className="flex gap-1">
        {Array.from({ length: thumbCount }).map((_, j) => (
          <div
            key={j}
            aria-hidden
            className="h-10 w-10 overflow-hidden rounded-xs"
            style={{ background: '#0c0a09' }}
          >
            <ThumbSvg variant={(variantIndex + j) % THUMB_VARIANTS.length} />
          </div>
        ))}
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[12.5px] font-medium tabular-nums text-ink">
          {when}
          {relative ? (
            <span className="ml-1.5 font-normal text-ink-faint">({relative})</span>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-2 text-[11px] text-ink-muted">
          <span>
            {study.imageCount} {study.imageCount === 1 ? 'imazh' : 'imazhe'}
          </span>
          <span className="rounded-xs border border-line bg-surface-subtle px-1.5 font-mono text-[10.5px] text-ink-faint">
            DICOM {shortId}
          </span>
          {study.studyDescription ? (
            <span className="truncate text-ink-faint">· {study.studyDescription}</span>
          ) : null}
          {disabled ? (
            <span className="font-medium text-ink-faint">· tashmë e lidhur</span>
          ) : null}
        </div>
      </div>
      <div
        aria-hidden
        className={cn(
          'grid h-5 w-5 place-items-center rounded-pill border transition',
          selected
            ? 'border-primary bg-primary text-white'
            : 'border-line-strong bg-transparent',
        )}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={selected ? 'opacity-100' : 'opacity-0'}
        >
          <path d="M2.5 6.5l2.5 2.5 4.5-5" />
        </svg>
      </div>
    </button>
  );
}

// =========================================================================
// Thumb variants (mirror the prototype's 4 SVG shapes — abstract
// ultrasound silhouettes, never real PHI)
// =========================================================================

const THUMB_VARIANTS = ['triangle', 'oval', 'spike', 'circle'] as const;

function ThumbSvg({ variant }: { variant: number }): ReactElement {
  const v = THUMB_VARIANTS[variant] ?? 'triangle';
  return (
    <svg viewBox="0 0 40 40" aria-hidden className="block h-full w-full">
      <rect width="40" height="40" fill="#0c0a09" />
      {v === 'triangle' ? (
        <>
          <path d="M20 4 L36 36 L4 36 Z" fill="#1c1917" />
          <ellipse cx="20" cy="26" rx="6" ry="4" fill="#44403c" />
        </>
      ) : v === 'oval' ? (
        <>
          <ellipse cx="20" cy="22" rx="14" ry="10" fill="#1c1917" />
          <ellipse cx="16" cy="22" rx="5" ry="3.5" fill="#292524" />
        </>
      ) : v === 'spike' ? (
        <>
          <path d="M20 8 L34 32 L6 32 Z" fill="#1c1917" />
          <ellipse cx="20" cy="24" rx="5" ry="3" fill="#44403c" />
        </>
      ) : (
        <>
          <ellipse cx="20" cy="22" rx="13" ry="9" fill="#1c1917" />
          <ellipse cx="20" cy="22" rx="3" ry="2" fill="#78716c" />
        </>
      )}
    </svg>
  );
}

// =========================================================================
// States
// =========================================================================

function PickerLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-2 py-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          aria-hidden
          className="grid grid-cols-[auto_1fr_auto] items-center gap-3.5 rounded-md border border-line px-3 py-2.5"
        >
          <div className="flex gap-1">
            {[0, 1, 2, 3].map((j) => (
              <div key={j} className="h-10 w-10 animate-pulse rounded-xs bg-surface-subtle" />
            ))}
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-40 animate-pulse rounded-xs bg-surface-subtle" />
            <div className="h-2.5 w-24 animate-pulse rounded-xs bg-surface-subtle" />
          </div>
          <div className="h-5 w-5 animate-pulse rounded-pill bg-surface-subtle" />
        </div>
      ))}
    </div>
  );
}

function EmptyList(): ReactElement {
  return (
    <div
      role="status"
      className="rounded-md border border-dashed border-line-strong bg-surface-subtle px-4 py-8 text-center text-[12.5px] text-ink-muted"
    >
      <div className="font-medium text-ink">Asnjë studim i pranuar</div>
      <div className="mt-1 text-[11.5px]">
        Ekzaminoni me ultrazërin që studimi të bie automatikisht këtu.
      </div>
    </div>
  );
}

// =========================================================================
// Helpers (exported for unit tests)
// =========================================================================

export function formatDdMmYyyy(iso: string): string {
  // Accepts both YYYY-MM-DD and full ISO timestamps; emits dd.MM.yyyy
  // in Europe/Belgrade. We don't import date-fns-tz here because the
  // picker only needs the calendar date — the timestamp is the
  // received-at moment and the doctor will read it in their local TZ.
  const [date] = iso.split('T');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  if (!match) return iso;
  const [, y, m, d] = match;
  return `${d}.${m}.${y}`;
}

export function formatDateTime(iso: string): string {
  // dd.MM.yyyy · HH:mm — matches the prototype's tabular-nums display.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const fmtDate = new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  const fmtTime = new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${fmtDate} · ${fmtTime}`;
}

/**
 * Relative-time label used only on the first card or two; older cards
 * skip the relative tag because absolute dates carry the meaning.
 * Returns "para 3 min" / "para 1 orë" / null for >2h.
 */
function useRelativeWhenLabel(iso: string): string | null {
  return useMemo(() => relativeWhenLabel(iso, new Date()), [iso]);
}

export function relativeWhenLabel(iso: string, now: Date): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 0) return null;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'para pak çastesh';
  if (minutes < 60) return `para ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 2) return `para ${hours} orë`;
  return null;
}
