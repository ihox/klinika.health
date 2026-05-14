'use client';

import {
  ageLabel,
  formatDob,
  type PatientFullDto,
} from '@/lib/patient-client';

interface Props {
  patient: PatientFullDto;
  /** Optional days-since-last-visit; renders the green/yellow/red indicator chip when present. */
  daysSinceLastVisit?: number | null;
  /** Total visit count for display. */
  visitCount?: number | null;
}

/**
 * Doctor's master-data strip — the dense horizontal header that sits
 * above the visit chart (slice 11 will adopt this).
 *
 * NEVER rendered for receptionists. The component imports
 * `PatientFullDto` directly; a TypeScript build error is the safety
 * net against accidental use in a receptionist screen.
 *
 * Color indicator chip:
 *   green   — last visit > 30 days ago (or no prior visits)
 *   yellow  — last visit 7–30 days ago
 *   red     — last visit 1–7 days ago
 */
export function MasterDataStrip({ patient, daysSinceLastVisit, visitCount }: Props) {
  const indicator = colorForDaysSinceVisit(daysSinceLastVisit);
  return (
    <div className="rounded-lg border border-stone-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <span className="font-mono text-[12.5px] text-stone-500">
          {patient.legacyId != null
            ? `#PT-${String(patient.legacyId).padStart(5, '0')}`
            : `#${patient.id.slice(0, 8)}`}
        </span>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-stone-900">
              {patient.firstName} {patient.lastName}
            </span>
            {patient.sex ? (
              <span
                className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-stone-100 px-1.5 text-[11px] font-semibold text-stone-600"
                aria-label={patient.sex === 'f' ? 'Femër' : 'Mashkull'}
              >
                {patient.sex === 'f' ? 'F' : 'M'}
              </span>
            ) : null}
            {indicator ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-medium ${indicator.cls}`}
                title={indicator.label}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${indicator.dot}`} aria-hidden />
                {daysSinceLastVisit} ditë
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-stone-500">
            {patient.dateOfBirth ? (
              <>
                <strong className="text-stone-700">{ageLabel(patient.dateOfBirth)}</strong>
                <span>· lindur {formatDob(patient.dateOfBirth)}</span>
              </>
            ) : (
              <span>DL pa caktuar</span>
            )}
            {patient.placeOfBirth ? (
              <>
                <span aria-hidden>·</span>
                <span>{patient.placeOfBirth}</span>
              </>
            ) : null}
            {patient.phone ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{patient.phone}</span>
              </>
            ) : null}
          </div>
        </div>

        <span className="hidden h-8 w-px bg-stone-200 sm:block" />

        <Stat label="Pesha lindjes" value={patient.birthWeightG} unit="g" format={formatInt} />
        <Stat label="Gjat. lindjes" value={patient.birthLengthCm} unit="cm" format={formatDecimal} />
        <Stat label="PK lindjes" value={patient.birthHeadCircumferenceCm} unit="cm" format={formatDecimal} />

        {visitCount != null ? (
          <>
            <span className="hidden h-8 w-px bg-stone-200 sm:block" />
            <Stat label="Vizita" value={visitCount} />
          </>
        ) : null}
      </div>

      {patient.alergjiTjera ? (
        <div className="flex items-start gap-2 border-t border-stone-100 bg-amber-50/40 px-5 py-2.5">
          <span
            aria-hidden
            className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-[12px] font-semibold text-amber-800"
          >
            !
          </span>
          <div className="text-[13px] text-amber-900">
            <span className="font-medium">Alergji / Tjera:</span> {patient.alergjiTjera}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  format,
}: {
  label: string;
  value: number | null | undefined;
  unit?: string;
  format?: (n: number) => string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-stone-400">{label}</span>
      <span className="text-[14px] font-medium text-stone-900">
        {value == null ? '—' : format ? format(value) : value}
        {value != null && unit ? (
          <small className="ml-0.5 text-stone-400">{unit}</small>
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

function colorForDaysSinceVisit(
  days: number | null | undefined,
): { cls: string; dot: string; label: string } | null {
  if (days == null) return null;
  if (days <= 7) {
    return {
      cls: 'bg-red-50 text-red-700',
      dot: 'bg-red-500',
      label: 'Vizitë e fundit brenda javës',
    };
  }
  if (days <= 30) {
    return {
      cls: 'bg-amber-50 text-amber-700',
      dot: 'bg-amber-500',
      label: 'Vizitë e fundit brenda muajit',
    };
  }
  return {
    cls: 'bg-emerald-50 text-emerald-700',
    dot: 'bg-emerald-500',
    label: 'Asnjë vizitë e fundit',
  };
}
