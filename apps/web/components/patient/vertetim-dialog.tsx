'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { ApiError } from '@/lib/api';
import {
  ageLabel,
  type PatientFullDto,
} from '@/lib/patient-client';
import { openPrintFrame } from '@/lib/print-frame';
import { printUrls, vertetimClient, type VertetimDto } from '@/lib/vertetim-client';
import type { VisitDto } from '@/lib/visit-client';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  patient: PatientFullDto;
  visit: VisitDto;
  /** Primary diagnosis preview — comes from the visit's first ICD-10. */
  primaryDiagnosis: { code: string; latinDescription: string } | null;
  onClose: () => void;
  /**
   * Notify the parent once a vërtetim is successfully issued, so
   * the chart's vërtetime panel can refresh. The dialog stays
   * open while the user reviews the preview / triggers print.
   */
  onIssued: (vertetim: VertetimDto) => void;
}

interface DialogState {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;

/**
 * "Lësho vërtetim absencë" modal — translated from
 * `design-reference/prototype/components/vertetim-dialog.html`.
 *
 * Flow:
 *   1. Doctor opens from the chart action bar.
 *   2. Picks a date range (Nga / Deri) or a quick-day chip.
 *   3. Preview card updates live with periudha + kohëzgjatja.
 *   4. "Shiko vërtetimin" → issues + opens PDF preview.
 *   5. "Printo vërtetimin" → issues + opens PDF + triggers print.
 *
 * Issuing freezes the diagnosis snapshot server-side; subsequent
 * edits to the visit's diagnosis do NOT change the printed PDF.
 */
export function VertetimDialog({
  open,
  patient,
  visit,
  primaryDiagnosis,
  onClose,
  onIssued,
}: Props): ReactElement | null {
  const today = todayIso();
  const [state, setState] = useState<DialogState>(() => ({
    from: today,
    to: addDaysIso(today, 4),
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setState({ from: today, to: addDaysIso(today, 4) });
    setError(null);
  }, [open, today]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const valid = state.from <= state.to;
  const durationDays = useMemo(() => {
    if (!valid) return 0;
    return diffDaysInclusive(state.from, state.to);
  }, [state.from, state.to, valid]);

  if (!open) return null;

  const ageMeta = ageLabel(patient.dateOfBirth);
  const sexLabel = patient.sex === 'm' ? 'M' : patient.sex === 'f' ? 'F' : '—';
  // Patient identifier — legacyId for migrated patients, otherwise a
  // short UUID slug so the dialog header still has *some* mono-typed
  // record reference. Matches the prototype's "PR-23-0142" framing.
  const patientCode = patient.legacyId != null
    ? `ID ${patient.legacyId}`
    : `ID ${patient.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  async function issueThen(action: 'view' | 'print'): Promise<void> {
    if (!valid) {
      setError('Periudha është e pavlefshme.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await vertetimClient.issue({
        visitId: visit.id,
        absenceFrom: state.from,
        absenceTo: state.to,
      });
      onIssued(res.vertetim);
      openPrintFrame({
        src: printUrls.vertetim(res.vertetim.id),
        autoPrint: action === 'print',
      });
      // Close the dialog only after queueing the print so the doctor
      // can move on without watching the iframe lifecycle.
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message || 'Lëshimi dështoi. Provoni përsëri.'
          : 'Lëshimi dështoi. Provoni përsëri.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  function applyChip(days: number): void {
    const from = state.from || today;
    setState({ from, to: addDaysIso(from, days - 1) });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="vertetim-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-[rgba(28,25,23,0.38)] p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[540px] animate-modal-in overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-modal">
        <header className="border-b border-line px-6 pb-3.5 pt-4">
          <h3
            id="vertetim-title"
            className="m-0 font-display text-[16px] font-semibold text-ink-strong"
          >
            Lësho vërtetim absencë
          </h3>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Vërtetimi printohet bashkë me diagnozën aktuale të vizitës.
          </p>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          {/* Patient header (read-only) */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-subtle px-3.5 py-2.5">
            <div className="min-w-0">
              <div
                className="font-display text-[15px] font-semibold tracking-[-0.01em] text-ink-strong"
                data-testid="vertetim-patient-name"
              >
                {patient.firstName} {patient.lastName}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                {ageMeta ? (
                  <>
                    <span>{ageMeta}</span>
                    <span className="text-line-strong">·</span>
                  </>
                ) : null}
                <span>{sexLabel}</span>
                <span className="text-line-strong">·</span>
                <span className="font-mono text-[11px] text-ink-faint">
                  {patientCode}
                </span>
              </div>
            </div>
            <span className="rounded-sm border border-line bg-surface-elevated px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
              Vetëm-lexim
            </span>
          </div>

          {/* Range pickers */}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-ink">
              Periudha e mungesës
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] items-end gap-2.5">
              <div className="min-w-0">
                <label
                  htmlFor="vertetim-from"
                  className="mb-1 block text-[11px] text-ink-faint"
                >
                  Nga
                </label>
                <input
                  id="vertetim-from"
                  type="date"
                  value={state.from}
                  onChange={(e) =>
                    setState((s) => ({ ...s, from: e.target.value }))
                  }
                  className={cn(
                    'block h-10 w-full rounded-md border bg-white px-3 text-[14px] text-ink shadow-sm transition focus:outline-none focus:ring-2 focus:ring-teal-500/30',
                    'border-line focus:border-teal-500',
                  )}
                />
              </div>
              <div className="pb-2.5 text-center text-[14px] text-ink-faint">→</div>
              <div className="min-w-0">
                <label
                  htmlFor="vertetim-to"
                  className={cn(
                    'mb-1 block text-[11px]',
                    valid ? 'text-ink-faint' : 'text-danger',
                  )}
                >
                  Deri
                </label>
                <input
                  id="vertetim-to"
                  type="date"
                  value={state.to}
                  onChange={(e) =>
                    setState((s) => ({ ...s, to: e.target.value }))
                  }
                  data-testid="vertetim-to"
                  className={cn(
                    'block h-10 w-full rounded-md border bg-white px-3 text-[14px] text-ink shadow-sm transition focus:outline-none focus:ring-2',
                    valid
                      ? 'border-line focus:border-teal-500 focus:ring-teal-500/30'
                      : 'border-danger focus:border-danger focus:ring-danger/20',
                  )}
                />
              </div>
            </div>
            {!valid ? (
              <div className="mt-2 flex items-center gap-1.5 text-[12px] text-danger">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="7" cy="7" r="5.5" />
                  <path d="M7 4v3.5M7 9.6v.01" />
                </svg>
                Data &quot;Deri&quot; duhet të jetë e barabartë ose pas datës &quot;Nga&quot;.
              </div>
            ) : null}

            <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Periudha të zakonshme">
              {QUICK_CHIPS.map((chip) => (
                <button
                  type="button"
                  key={chip.days}
                  onClick={() => applyChip(chip.days)}
                  aria-pressed={chip.days === durationDays}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[12px] transition',
                    chip.days === durationDays
                      ? 'border-teal-300 bg-primary-soft font-medium text-teal-800'
                      : 'border-line-strong bg-surface-elevated text-ink-muted hover:bg-surface-subtle hover:text-ink',
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* Preview card */}
          <div
            className={cn(
              'rounded-md border px-3.5 py-3 transition-opacity',
              valid
                ? 'border-teal-200 bg-primary-tint'
                : 'border-line bg-surface-subtle opacity-60',
            )}
            data-testid="vertetim-preview"
          >
            <div className="flex items-baseline justify-between gap-3.5">
              <span
                className={cn(
                  'text-[10.5px] font-semibold uppercase tracking-[0.08em]',
                  valid ? 'text-teal-800' : 'text-ink-faint',
                )}
              >
                Periudha
              </span>
              <span
                className={cn(
                  'font-display text-[15px] font-semibold tabular-nums tracking-[-0.01em]',
                  valid ? 'text-ink-strong' : 'text-ink-faint',
                )}
                data-testid="vertetim-preview-period"
              >
                {valid ? (
                  <>
                    {formatDdMmYyyy(state.from)} — {formatDdMmYyyy(state.to)}{' '}
                    <span className="ml-1 font-normal text-ink-muted">
                      · {durationDays} {durationDays === 1 ? 'ditë' : 'ditë'}
                    </span>
                  </>
                ) : (
                  '— periudhë e pavlefshme —'
                )}
              </span>
            </div>
            <div
              className={cn(
                'mt-2 flex items-center gap-2 border-t pt-2 text-[12.5px]',
                valid ? 'border-teal-200 text-ink' : 'border-line text-ink-faint',
              )}
            >
              {primaryDiagnosis ? (
                <>
                  <span
                    className={cn(
                      'rounded-sm border bg-surface-elevated px-1.5 py-[1px] font-mono text-[11px]',
                      valid
                        ? 'border-teal-200 text-teal-800'
                        : 'border-line text-ink-muted',
                    )}
                  >
                    {primaryDiagnosis.code}
                  </span>
                  <span>{primaryDiagnosis.latinDescription}</span>
                </>
              ) : (
                <span className="italic text-ink-muted">
                  Pa diagnozë të strukturuar — do të përdoret teksti i vjetër.
                </span>
              )}
            </div>
          </div>

          {error ? (
            <p
              role="alert"
              className="rounded-sm border border-danger-soft bg-danger-bg px-3 py-2 text-[12px] text-danger"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2.5 border-t border-line bg-surface-subtle px-6 py-3">
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
            onClick={() => void issueThen('view')}
            disabled={!valid || busy}
            data-testid="vertetim-view"
            className="inline-flex h-9 items-center rounded-md border border-line bg-surface-elevated px-3 text-[13px] font-medium text-ink-strong shadow-xs hover:bg-surface-subtle disabled:opacity-60"
          >
            Shiko vërtetimin
          </button>
          <button
            type="button"
            onClick={() => void issueThen('print')}
            disabled={!valid || busy}
            data-testid="vertetim-print"
            className="inline-flex h-9 items-center rounded-md border border-transparent bg-primary px-3 text-[13px] font-medium text-white shadow-xs hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Duke lëshuar…' : 'Printo vërtetimin'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers — exported for unit tests.
// ---------------------------------------------------------------------------

interface QuickChip {
  days: number;
  label: string;
}

const QUICK_CHIPS: readonly QuickChip[] = [
  { days: 1, label: 'Sot' },
  { days: 3, label: '3 ditë' },
  { days: 5, label: '5 ditë' },
  { days: 7, label: '1 javë' },
  { days: 10, label: '10 ditë' },
];

function todayIso(): string {
  // Belgrade calendar date — the doctor expects the picker to show
  // their local "today" regardless of the host TZ.
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Belgrade' });
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDaysInclusive(fromIso: string, toIso: string): number {
  const f = new Date(`${fromIso}T00:00:00Z`).getTime();
  const t = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.floor((t - f) / DAY_MS) + 1;
}

function formatDdMmYyyy(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}
