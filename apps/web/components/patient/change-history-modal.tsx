'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  type VisitHistoryEntryDto,
  type VisitHistoryFieldChange,
  visitClient,
} from '@/lib/visit-client';

const TRUNCATE_THRESHOLD = 120;

interface Props {
  visitId: string;
  visitDate: string;
  patientName: string;
  onClose: () => void;
}

/**
 * Read-only timeline of every audit row touching this visit. Mirrors
 * design-reference/prototype/components/edit-history-modal.html: a
 * vertical rail with dots + lines, one event per audit entry. The
 * "Krijuar (vizita e re)" pill is always last.
 *
 * Long string values truncate at {@link TRUNCATE_THRESHOLD} chars with
 * a "Shfaq plotësisht" / "Shfaq më pak" expander.
 *
 * Esc and clicking the backdrop both close the modal. No restore /
 * rollback in v1 — the prototype's footer is explicit about this.
 */
export function ChangeHistoryModal({
  visitId,
  visitDate,
  patientName,
  onClose,
}: Props): ReactElement {
  const [entries, setEntries] = useState<VisitHistoryEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    (async () => {
      try {
        const res = await visitClient.history(visitId);
        if (!cancelled) setEntries(res.entries);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setError('Vizita nuk u gjet.');
        } else {
          setError('Historia nuk u ngarkua. Provoni përsëri.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visitId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const eventCount = entries?.length ?? 0;

  return (
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-modal grid place-items-center bg-black/40 px-4 py-10 backdrop-blur-[3px]"
    >
      <div
        role="dialog"
        aria-labelledby="history-modal-title"
        className="relative max-h-[min(640px,calc(100vh-80px))] w-full max-w-[620px] overflow-hidden rounded-xl border border-line bg-surface-elevated shadow-modal animate-modal-in"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h3
              id="history-modal-title"
              className="text-[16px] font-semibold text-ink-strong"
            >
              Historia e ndryshimeve{' '}
              <span className="font-medium text-ink-muted">
                · Vizita e {formatDate(visitDate)}
              </span>
            </h3>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              {patientName} · {eventCount}{' '}
              {eventCount === 1 ? 'ngjarje' : 'ngjarje'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Mbyll"
            className="grid h-7 w-7 place-items-center rounded-sm text-ink-faint hover:bg-surface-subtle hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div className="max-h-[460px] overflow-y-auto px-6 py-4">
          {error ? (
            <div className="rounded-md border border-warning-soft bg-warning-bg px-3 py-3 text-[13px] text-warning">
              {error}
            </div>
          ) : entries == null ? (
            <div className="py-6 text-center text-[13px] text-ink-muted">
              Duke ngarkuar...
            </div>
          ) : entries.length === 0 ? (
            <div className="py-6 text-center text-[13px] italic text-ink-muted">
              Asnjë ngjarje për këtë vizitë
            </div>
          ) : (
            <ol className="flex flex-col gap-5">
              {entries.map((e, idx) => (
                <HistoryEvent
                  key={e.id}
                  entry={e}
                  isLatest={idx === 0}
                  isLast={idx === entries.length - 1}
                />
              ))}
            </ol>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line bg-surface-subtle px-6 py-3">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-faint">
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect x="2" y="5" width="8" height="6" rx="1" />
              <path d="M4 5V3.5a2 2 0 0 1 4 0V5" />
            </svg>
            Vetëm-lexim · audit log
          </span>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Mbyll
          </Button>
        </footer>
      </div>
    </div>
  );
}

// =========================================================================
// One event in the timeline
// =========================================================================

interface HistoryEventProps {
  entry: VisitHistoryEntryDto;
  isLatest: boolean;
  isLast: boolean;
}

function HistoryEvent({ entry, isLatest, isLast }: HistoryEventProps): ReactElement {
  // ADR-013 Slice G: both `visit.created` (legacy rows) and
  // `visit.standalone.created` (post-Slice-G standalone visits) are
  // creation events for the chart's history timeline — they share
  // the same dot, ribbon, and "Krijuar" badge styling.
  const isCreation =
    entry.action === 'visit.created' ||
    entry.action === 'visit.standalone.created';
  return (
    <li className="grid grid-cols-[24px_1fr] gap-3.5">
      <div className="flex flex-col items-center">
        <span
          aria-hidden
          className={[
            'mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface-elevated shadow-[0_0_0_1px_var(--tw-shadow-color)] shadow-line-strong',
            isLatest ? '!shadow-primary bg-primary' : 'bg-ink-faint',
            isCreation && !isLatest ? 'bg-surface-elevated !shadow-line-strong' : '',
          ].join(' ')}
        />
        {!isLast ? (
          <span className="mt-1 w-px flex-1 bg-line" aria-hidden />
        ) : null}
      </div>

      <div>
        <div className="flex flex-wrap items-baseline gap-2 text-[13px]">
          <span className="font-semibold text-ink">{entry.userDisplayName}</span>
          <span className="text-[11.5px] tabular-nums text-ink-faint">
            {formatDateTime(entry.timestamp)}
          </span>
          {entry.ipAddress ? (
            <span className="font-mono text-[10.5px] text-ink-faint">
              {redactIp(entry.ipAddress)}
            </span>
          ) : null}
          {!isCreation && entry.action !== 'visit.updated' ? (
            <span className="ml-1 rounded-full bg-warning-bg px-2 py-0.5 text-[10.5px] font-medium uppercase tracking-[0.05em] text-warning">
              {actionLabel(entry.action)}
            </span>
          ) : null}
        </div>

        {isCreation ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-subtle px-2.5 py-1 text-[12px] text-ink-muted">
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
              aria-hidden
            >
              <path d="M6 1.5v9M1.5 6h9" />
            </svg>
            Krijuar (vizita e re)
          </div>
        ) : entry.changes && entry.changes.length > 0 ? (
          <div className="mt-2 flex flex-col gap-2">
            {entry.changes.map((c) => (
              <FieldDiff key={c.field} change={c} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

interface FieldDiffProps {
  change: VisitHistoryFieldChange;
}

function FieldDiff({ change }: FieldDiffProps): ReactElement {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-surface-elevated">
      <div className="border-b border-line bg-surface-subtle px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
        {fieldLabel(change.field)}
      </div>
      <div className="grid grid-cols-[60px_1fr] gap-2.5 px-3 py-2.5 text-[12.5px] leading-snug">
        <div className="text-[10.5px] font-medium text-ink-faint">më parë</div>
        <ValueCell value={change.old} kind="then" />
        <div className="border-t border-line-soft pt-2 text-[10.5px] font-medium text-ink-faint">
          tani
        </div>
        <div className="border-t border-line-soft pt-2">
          <ValueCell value={change.new} kind="now" />
        </div>
      </div>
    </div>
  );
}

function ValueCell({
  value,
  kind,
}: {
  value: VisitHistoryFieldChange['old'];
  kind: 'then' | 'now';
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  if (value == null || value === '') {
    return <em className="text-ink-faint">— bosh —</em>;
  }
  const stringValue =
    typeof value === 'boolean' ? (value ? 'Po' : 'Jo') : String(value);
  const isLong = stringValue.length > TRUNCATE_THRESHOLD;
  const displayed = expanded || !isLong
    ? stringValue
    : `${stringValue.slice(0, TRUNCATE_THRESHOLD)}…`;
  return (
    <div>
      <div
        className={[
          'whitespace-pre-wrap break-words',
          kind === 'then'
            ? 'text-ink-faint line-through decoration-line-strong'
            : 'font-medium text-ink-strong',
        ].join(' ')}
      >
        {displayed}
      </div>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-[11px] font-medium text-primary hover:underline"
        >
          {expanded ? 'Shfaq më pak' : 'Shfaq plotësisht'}
        </button>
      ) : null}
    </div>
  );
}

// =========================================================================
// Field-name → Albanian label
// =========================================================================
//
// These must match the prototype's wording (CLAUDE.md §1.5 — Albanian
// only). Adding a new field to the visit shape requires adding a label
// here; the fallback shows the raw key so missing entries surface as
// dev-visible bugs rather than silent UI breakage.

const FIELD_LABELS: Record<string, string> = {
  visitDate: 'Data e vizitës',
  complaint: 'Ankesa',
  feedingNotes: 'Shënim për ushqimin',
  feedingBreast: 'Ushqim — Gji',
  feedingFormula: 'Ushqim — Formulë',
  feedingSolid: 'Ushqim — Solid',
  weightG: 'Pesha',
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
  deletedAt: 'Fshirja',
  patientId: 'Pacienti',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function actionLabel(action: string): string {
  if (action === 'visit.deleted') return 'Fshirë';
  if (action === 'visit.restored') return 'Rikthyer';
  return action;
}

function redactIp(ip: string): string {
  // IPv4 — keep first two octets, mask the last two for the audit
  // viewer's defense-in-depth display.
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.•.•`;
  }
  return '•';
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const fmt = new Intl.DateTimeFormat('sq-AL', {
    timeZone: 'Europe/Belgrade',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')} · ${get('hour')}:${get('minute')}`;
}
