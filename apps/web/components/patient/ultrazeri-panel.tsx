'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';

import {
  dicomClient,
  dicomPreviewUrl,
  type DicomLinkDto,
} from '@/lib/dicom-client';
import { cn } from '@/lib/utils';

import { DicomLightbox } from './dicom-lightbox';
import { DicomPickerDialog } from './dicom-picker-dialog';

interface Props {
  /** Active visit on the chart — the panel attaches studies to this id. */
  visitId: string;
  visitDateIso: string;
  patientName: string;
}

/**
 * Ultrazeri panel — translates the right-column "Ultrazeri" block
 * from `design-reference/prototype/chart.html` plus the picker /
 * lightbox interactions.
 *
 * Renders:
 *   - Panel header with title + "+ Lidh studim"
 *   - 3-column thumbnail grid of linked studies (first image's preview
 *     proxied through the authenticated endpoint)
 *   - Empty state when no studies are linked
 *
 * State:
 *   - Linked studies are fetched on mount + on every successful link
 *   - Picker / lightbox are mounted at the panel level so the parent
 *     chart-view doesn't need to know about either modal.
 */
export function UltrazeriPanel({
  visitId,
  visitDateIso,
  patientName,
}: Props): ReactElement {
  const [links, setLinks] = useState<DicomLinkDto[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [lightboxStudyId, setLightboxStudyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await dicomClient.listLinks(visitId);
      setLinks(res.links);
    } catch {
      // Silent. The empty-state shows when fetch fails repeatedly;
      // a one-off network blip during the chart's normal navigation
      // shouldn't surface an error toast.
    }
  }, [visitId]);

  useEffect(() => {
    let cancelled = false;
    setLinks(null);
    (async () => {
      try {
        const res = await dicomClient.listLinks(visitId);
        if (!cancelled) setLinks(res.links);
      } catch {
        if (!cancelled) setLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  const linkedStudyIds = useMemo(
    () => new Set((links ?? []).map((l) => l.dicomStudyId)),
    [links],
  );

  return (
    <section
      aria-label="Ultrazeri"
      data-testid="ultrazeri-panel"
      className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-[12.5px] font-semibold text-ink-strong">Ultrazeri</h3>
        <button
          type="button"
          data-testid="ultrazeri-open-picker"
          onClick={() => setPickerOpen(true)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-primary hover:bg-primary-tint"
        >
          + Lidh studim
        </button>
      </header>

      {links == null ? (
        <ThumbsLoading />
      ) : links.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid grid-cols-3 gap-2 p-3">
          {links.map((link) => (
            <li key={link.id}>
              <LinkedThumb
                link={link}
                onOpen={() => setLightboxStudyId(link.dicomStudyId)}
              />
            </li>
          ))}
        </ul>
      )}

      <DicomPickerDialog
        open={pickerOpen}
        visitId={visitId}
        visitDateIso={visitDateIso}
        patientName={patientName}
        alreadyLinkedStudyIds={linkedStudyIds}
        onClose={() => setPickerOpen(false)}
        onLinked={() => {
          void refresh();
        }}
      />

      {lightboxStudyId ? (
        <DicomLightbox
          open={true}
          studyId={lightboxStudyId}
          patientName={patientName}
          visitDateIso={visitDateIso}
          onClose={() => setLightboxStudyId(null)}
        />
      ) : null}
    </section>
  );
}

// =========================================================================
// Pieces
// =========================================================================

function LinkedThumb({
  link,
  onOpen,
}: {
  link: DicomLinkDto;
  onOpen: () => void;
}): ReactElement {
  // The picker stores only the parent study id; the lightbox lazily
  // fetches the instance list. For the thumbnail strip on the chart
  // we don't have an instance id without an extra round-trip, so the
  // preview is the SVG fallback shape used by the prototype. Real
  // first-frame previews land once the doctor opens the lightbox.
  const dateLabel = formatLinkedAt(link.linkedAt);
  return (
    <button
      type="button"
      data-testid={`ultrazeri-thumb-${link.dicomStudyId}`}
      onClick={onOpen}
      className={cn(
        'relative aspect-square w-full overflow-hidden rounded-sm transition hover:ring-2 hover:ring-primary/40',
      )}
      style={{ background: '#0c0a09' }}
      aria-label={`Hap studimin e ${dateLabel}`}
    >
      <PlaceholderThumb seed={link.id} />
      <span className="absolute bottom-1 left-1.5 font-mono text-[9px] text-white/70">
        {dateLabel}
      </span>
    </button>
  );
}

function PlaceholderThumb({ seed }: { seed: string }): ReactElement {
  // Deterministic variant pick from the link id so the same study
  // always shows the same silhouette across re-renders.
  const variant =
    seed
      .split('')
      .reduce((acc, c) => (acc + c.charCodeAt(0)) % 4, 0) || 0;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      className="block h-full w-full"
      aria-hidden
    >
      <rect width="100" height="100" fill="#0c0a09" />
      {variant === 0 ? (
        <>
          <ellipse cx="50" cy="55" rx="35" ry="25" fill="#1c1917" opacity="0.9" />
          <ellipse cx="50" cy="55" rx="22" ry="14" fill="#292524" />
          <circle cx="48" cy="50" r="3" fill="#57534E" />
        </>
      ) : variant === 1 ? (
        <>
          <path d="M 50 10 L 90 90 L 10 90 Z" fill="#1c1917" />
          <path d="M 50 25 L 75 85 L 25 85 Z" fill="#292524" />
          <ellipse cx="50" cy="65" rx="10" ry="6" fill="#57534E" />
        </>
      ) : variant === 2 ? (
        <>
          <ellipse cx="50" cy="55" rx="40" ry="30" fill="#1c1917" />
          <ellipse cx="40" cy="55" rx="14" ry="10" fill="#292524" />
          <ellipse cx="60" cy="60" rx="9" ry="6" fill="#292524" />
        </>
      ) : (
        <>
          <path d="M 50 5 L 90 95 L 10 95 Z" fill="#1c1917" />
          <ellipse cx="50" cy="60" rx="14" ry="9" fill="#44403c" />
        </>
      )}
    </svg>
  );
}

function ThumbsLoading(): ReactElement {
  return (
    <div aria-hidden className="grid grid-cols-3 gap-2 p-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="aspect-square w-full animate-pulse rounded-sm bg-surface-subtle"
        />
      ))}
    </div>
  );
}

function EmptyState(): ReactElement {
  return (
    <div className="px-4 py-5 text-center text-[11.5px] text-ink-faint">
      Asnjë studim i lidhur me këtë vizitë.
    </div>
  );
}

function formatLinkedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/**
 * Internal helper exported for unit tests — preview URL is built by
 * the dicom-client export, so the panel doesn't compute the URL
 * itself. Kept here in case tests need to assert against it.
 */
export const _testHooks = { dicomPreviewUrl };
