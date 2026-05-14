'use client';

import {
  ageLabelChart,
  daysSinceVisitColor,
  formatDob,
  type DaysSinceVisitColor,
  type PatientFullDto,
} from '@/lib/patient-client';
import { cn } from '@/lib/utils';

interface Props {
  patient: PatientFullDto;
  /**
   * Days since this patient's most recent non-deleted visit. Drives
   * the green/amber/red indicator chip. `null` means "no prior visit
   * recorded" — the chip is hidden entirely.
   */
  daysSinceLastVisit?: number | null;
  /** Total visit count; if provided, rendered alongside the master data. */
  visitCount?: number | null;
}

/**
 * Doctor's master-data strip — the dense header that sits above the
 * chart's visit form. Mirrors design-reference/prototype/chart.html
 * lines 1578-1638.
 *
 * Layout:
 *
 *   Row 1: ID · Name (+sex pill +indicator chip) · age · place · phone
 *   Row 2: Lindja: birth date · pesha · gjatësia · PK · Vizita
 *   Row 3 (only when populated): amber "Alergji / Tjera" wash with
 *           full text visible on hover (rest of the text is clipped
 *           with an ellipsis so a long note doesn't blow the layout).
 *
 * NEVER rendered for receptionists — `PatientFullDto` is the doctor's
 * shape. The TypeScript build is the safety net.
 */
export function MasterDataStrip({ patient, daysSinceLastVisit, visitCount }: Props) {
  const indicator =
    daysSinceLastVisit != null ? daysSinceVisitColor(daysSinceLastVisit) : null;
  return (
    <div className="bg-surface-elevated">
      {/* ── Row 1: identity ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 py-4">
        <span className="font-mono text-[11px] tabular-nums text-ink-faint rounded-xs border border-line bg-surface-subtle px-2 py-0.5">
          {patient.legacyId != null
            ? `#PT-${String(patient.legacyId).padStart(5, '0')}`
            : `#${patient.id.slice(0, 8)}`}
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="font-display text-[22px] font-semibold leading-[1.1] tracking-[-0.02em] text-ink-strong">
              {patient.firstName} {patient.lastName}
            </span>
            {patient.sex ? (
              <span
                className={cn(
                  'inline-flex h-5 min-w-[20px] items-center justify-center rounded-xs border px-1.5 text-[10px] font-semibold uppercase tracking-[0.05em]',
                  patient.sex === 'f'
                    ? 'border-pink-200 bg-pink-50 text-pink-700'
                    : 'border-blue-200 bg-blue-50 text-blue-700',
                )}
                aria-label={patient.sex === 'f' ? 'Femër' : 'Mashkull'}
              >
                {patient.sex.toUpperCase()}
              </span>
            ) : null}
            {indicator && daysSinceLastVisit != null ? (
              <IndicatorChip color={indicator} days={daysSinceLastVisit} />
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 text-[12px] text-ink-muted">
            {patient.dateOfBirth ? (
              <strong className="font-medium text-ink">
                {ageLabelChart(patient.dateOfBirth)}
              </strong>
            ) : (
              <span className="italic">DL pa caktuar</span>
            )}
            {patient.placeOfBirth ? (
              <>
                <Sep />
                <span>{patient.placeOfBirth}</span>
              </>
            ) : null}
            {patient.phone ? (
              <>
                <Sep />
                <span className="tabular-nums">{patient.phone}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* ── Row 2: Lindja sub-row ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-soft px-1 py-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          Lindja
        </span>
        <Stat
          label="Data"
          value={patient.dateOfBirth ? formatDob(patient.dateOfBirth) : null}
          mono
        />
        <Stat
          label="Pesha"
          value={patient.birthWeightG}
          unit="g"
          format={formatInt}
        />
        <Stat
          label="Gjatësia"
          value={patient.birthLengthCm}
          unit="cm"
          format={formatDecimal}
        />
        <Stat
          label="PK"
          value={patient.birthHeadCircumferenceCm}
          unit="cm"
          format={formatDecimal}
        />
        {visitCount != null ? (
          <>
            <span className="hidden h-7 w-px bg-line sm:block" />
            <Stat label="Vizita" value={visitCount} />
          </>
        ) : null}
      </div>

      {/* ── Row 3 (conditional): Alergji / Tjera ───────────────────── */}
      {patient.alergjiTjera ? (
        <AllergiesRow text={patient.alergjiTjera} />
      ) : null}
    </div>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-line-strong">
      ·
    </span>
  );
}

function IndicatorChip({
  color,
  days,
}: {
  color: DaysSinceVisitColor;
  days: number;
}) {
  const tone =
    color === 'red'
      ? 'border-danger-soft bg-danger-bg text-danger'
      : color === 'amber'
        ? 'border-warning-soft bg-warning-bg text-warning'
        : 'border-success-soft bg-success-bg text-success';
  const dot =
    color === 'red' ? 'bg-danger' : color === 'amber' ? 'bg-warning' : 'bg-success';
  const label =
    color === 'red'
      ? 'Vizitë e fundit brenda javës'
      : color === 'amber'
        ? 'Vizitë e fundit brenda muajit'
        : 'Vizitë e fundit më shumë se 30 ditë më parë';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-2 py-0.5 text-[11px] font-medium tabular-nums',
        tone,
      )}
      title={label}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      {days} {days === 1 ? 'ditë' : 'ditë'}
    </span>
  );
}

function AllergiesRow({ text }: { text: string }) {
  // The full text is in `title` so a long allergy note (rare —
  // doctors keep it terse) doesn't blow up the strip layout while
  // staying accessible on hover.
  return (
    <div
      className="group flex items-center gap-2.5 border-t border-warning-soft bg-warning-bg px-1 py-2 text-[12.5px] text-amber-900"
      title={text}
    >
      <span
        aria-hidden
        className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-warning text-[11px] font-bold leading-none text-white"
      >
        !
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-warning">
        Alergji / Tjera
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-amber-900 group-hover:whitespace-normal group-hover:break-words">
        {text}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  format,
  mono,
}: {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  format?: (n: number) => string;
  mono?: boolean;
}) {
  const rendered =
    value == null
      ? '—'
      : typeof value === 'number' && format
        ? format(value)
        : value;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-[0.07em] text-ink-faint">
        {label}
      </span>
      <span
        className={cn(
          'text-[15px] font-semibold leading-none tabular-nums text-ink-strong',
          mono && 'font-mono text-[13px]',
        )}
      >
        {rendered}
        {value != null && unit ? (
          <small className="ml-0.5 text-[11px] font-normal tracking-normal text-ink-faint">
            {unit}
          </small>
        ) : null}
      </span>
    </div>
  );
}

function formatInt(n: number): string {
  return n.toLocaleString('sq-AL');
}

function formatDecimal(n: number): string {
  return Number.isInteger(n) ? n.toString() : n.toFixed(1);
}
