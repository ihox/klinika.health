'use client';

import { useMemo, useState, type ReactElement } from 'react';

import {
  isToddlerAge,
  pointsForMetric,
  resolveSex,
  sexChipLabel,
  toneForSex,
  type PatientSexCode,
} from '@/lib/growth-chart';
import {
  type ChartGrowthPointDto,
  type PatientFullDto,
} from '@/lib/patient-client';
import {
  estimatePercentileLabel,
  getWhoReference,
  type GrowthMetric,
  WHO_METRIC_META,
} from '@/lib/who-growth-data/who-growth-data';
import { cn } from '@/lib/utils';
import { GrowthChartModal } from './growth-chart-modal';

interface Props {
  patient: PatientFullDto;
  ageMonths: number | null;
  growthPoints: readonly ChartGrowthPointDto[];
  /**
   * Called when the doctor clicks the "set sex inline" button on the
   * placeholder. The chart shell wires this to the master-data
   * edit flow.
   */
  onRequestSetSex?: () => void;
}

/**
 * Patient-chart right-column panel for the WHO growth charts.
 *
 *   ≤ 24 months + known sex → three sparkline cards, click any to open modal.
 *   > 24 months + has 0-24mo data → "Shiko grafikët historikë" link.
 *   > 24 months + no 0-24mo data → hidden entirely.
 *   Sex unresolved → placeholder asking the doctor to set it inline.
 *
 * Mirrors design-reference/prototype/chart.html (lines 1844-1924) and
 * design-reference/prototype/components/growth-chart-modal.html for
 * the modal itself.
 */
export function GrowthPanel({
  patient,
  ageMonths,
  growthPoints,
  onRequestSetSex,
}: Props): ReactElement | null {
  const sex = useMemo(
    () => resolveSex({ sex: patient.sex, firstName: patient.firstName }),
    [patient.sex, patient.firstName],
  );

  const [modal, setModal] = useState<{
    open: boolean;
    metric: GrowthMetric;
    historical: boolean;
  }>({ open: false, metric: 'weight', historical: false });

  const inWhoBand = useMemo(
    () => growthPoints.filter((p) => p.ageMonths >= 0 && p.ageMonths <= 24),
    [growthPoints],
  );

  // Patient is past 24 months — surface the historical link only when
  // there's something to look at.
  const isToddler = isToddlerAge(ageMonths);
  if (!isToddler && inWhoBand.length === 0 && ageMonths != null) {
    return null;
  }

  if (sex == null) {
    return (
      <section
        aria-label="Diagramet e rritjes"
        className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h3 className="text-[12.5px] font-semibold text-ink-strong">
            Diagramet e rritjes
          </h3>
          <span className="text-[11px] text-ink-faint">WHO</span>
        </header>
        <UnknownSexPlaceholder onRequestSetSex={onRequestSetSex} />
      </section>
    );
  }

  if (!isToddler) {
    return (
      <>
        <section
          aria-label="Diagramet historike të rritjes"
          className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
        >
          <button
            type="button"
            onClick={() =>
              setModal({ open: true, metric: 'weight', historical: true })
            }
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-subtle"
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-ink-strong">
                Shiko grafikët historikë
              </span>
              <span className="text-[11.5px] text-ink-muted">
                {inWhoBand.length} matje 0–24 muaj · WHO percentilet
              </span>
            </span>
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-ink-muted"
              aria-hidden
            >
              <path d="M5 3l5 5-5 5" />
            </svg>
          </button>
        </section>
        <GrowthChartModal
          open={modal.open}
          patientName={`${patient.firstName} ${patient.lastName}`}
          patientSex={sex}
          growthPoints={inWhoBand}
          initialMetric={modal.metric}
          historical={modal.historical}
          onClose={() => setModal((m) => ({ ...m, open: false }))}
        />
      </>
    );
  }

  return (
    <>
      <section
        aria-label="Diagramet e rritjes"
        className="overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-xs"
      >
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h3 className="text-[12.5px] font-semibold text-ink-strong">
            Diagramet e rritjes · WHO
          </h3>
          {/* Sex-tinted patient chip — blue for boys, pink for girls.
              Color alone never carries the signal: the Albanian label
              (Djalë / Vajzë) is the non-color accessibility backup so
              color-blind doctors get the same information. Tokens
              `--chart-male*` / `--chart-female*` defined in globals.css
              and mirrored in tailwind.config. */}
          <span data-testid="growth-panel-sex-chip" data-tone={toneForSex(sex)}>
            <SexTintedChip sex={sex} />
          </span>
        </header>
        {inWhoBand.length === 0 ? (
          <EmptyState />
        ) : (
          <div data-testid="growth-sparklines">
            <SparklineCard
              metric="weight"
              patientSex={sex}
              growthPoints={inWhoBand}
              onOpen={() =>
                setModal({ open: true, metric: 'weight', historical: false })
              }
            />
            <Divider />
            <SparklineCard
              metric="length"
              patientSex={sex}
              growthPoints={inWhoBand}
              onOpen={() =>
                setModal({ open: true, metric: 'length', historical: false })
              }
            />
            <Divider />
            <SparklineCard
              metric="hc"
              patientSex={sex}
              growthPoints={inWhoBand}
              onOpen={() =>
                setModal({ open: true, metric: 'hc', historical: false })
              }
            />
          </div>
        )}
      </section>
      <GrowthChartModal
        open={modal.open}
        patientName={`${patient.firstName} ${patient.lastName}`}
        patientSex={sex}
        growthPoints={inWhoBand}
        initialMetric={modal.metric}
        historical={modal.historical}
        onClose={() => setModal((m) => ({ ...m, open: false }))}
      />
    </>
  );
}

function Divider() {
  return <div aria-hidden className="h-px bg-line" />;
}

/**
 * Patient chip rendered in the growth-panel header. Mirrors
 * `.growth-patient-chip` in design-reference/prototype/chart.html —
 * sex-tinted background + border driven by the canonical
 * `--chart-male*` / `--chart-female*` tokens, with the colored dot
 * matching the patient line color downstream. The "Djalë" / "Vajzë"
 * label is always present so the chip never relies on color alone.
 */
function SexTintedChip({ sex }: { sex: PatientSexCode }): ReactElement {
  const tone = toneForSex(sex);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[11px] font-medium text-ink',
        tone === 'male'
          ? 'border-chart-male-border bg-chart-male-bg'
          : 'border-chart-female-border bg-chart-female-bg',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-[7px] w-[7px] rounded-full',
          tone === 'male' ? 'bg-chart-male' : 'bg-chart-female',
        )}
      />
      <span className="text-ink-muted font-normal">{sexChipLabel(sex)}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Sparkline card
// ---------------------------------------------------------------------------

function SparklineCard({
  metric,
  patientSex,
  growthPoints,
  onOpen,
}: {
  metric: GrowthMetric;
  patientSex: PatientSexCode;
  growthPoints: readonly ChartGrowthPointDto[];
  onOpen: () => void;
}): ReactElement {
  const meta = WHO_METRIC_META[metric];
  const reference = getWhoReference(metric, patientSex);
  const series = pointsForMetric(growthPoints, metric, 'who');
  const tone = toneForSex(patientSex);

  const last = series.points[series.points.length - 1] ?? null;
  const pctLabel = last
    ? estimatePercentileLabel(reference, last.ageMonths, last.value)
    : '—';
  const warn = isWarnPercentile(pctLabel);

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`growth-sparkline-${metric}`}
      data-tone={tone}
      aria-label={`Hap grafikun: ${meta.title}`}
      className="grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 pb-2.5 pt-2.5 text-left transition-colors hover:bg-surface-subtle"
      style={{ gridTemplateAreas: '"title pct" "svg svg"' }}
    >
      <span
        className="text-[13px] font-medium text-ink"
        style={{ gridArea: 'title' }}
      >
        {meta.shortTitle === 'Pesha'
          ? 'Pesha sipas moshës'
          : meta.shortTitle === 'Gjatësia'
            ? 'Gjatësia sipas moshës'
            : 'Perimetri i kokës'}
      </span>
      <span
        className={cn(
          'font-mono text-[11px] font-semibold tabular-nums',
          warn ? 'text-warning' : 'text-teal-700',
        )}
        style={{ gridArea: 'pct' }}
      >
        {pctLabel}
      </span>
      <SparklineSvg
        metric={metric}
        reference={reference}
        series={series.points}
        tone={tone}
      />
    </button>
  );
}

function isWarnPercentile(label: string): boolean {
  if (label === '—') return false;
  if (label.startsWith('<') || label.startsWith('>')) return true;
  const n = Number(label.replace('P', ''));
  if (!Number.isFinite(n)) return false;
  return n < 15 || n > 85;
}

// ---------------------------------------------------------------------------
// Compact sparkline SVG
// ---------------------------------------------------------------------------

const SPARK_VIEWBOX = { w: 380, h: 100 };

function SparklineSvg({
  metric,
  reference,
  series,
  tone,
}: {
  metric: GrowthMetric;
  reference: ReturnType<typeof getWhoReference>;
  series: Array<{ visitId: string; ageMonths: number; value: number; visitDate: string }>;
  tone: 'male' | 'female';
}): ReactElement {
  const { w, h } = SPARK_VIEWBOX;
  const meta = WHO_METRIC_META[metric];
  const xScale = (m: number) => (m / 24) * w;
  const yScale = (v: number) =>
    ((meta.yMax - v) / (meta.yMax - meta.yMin)) * h;

  const lineFor = (arr: number[]) =>
    arr
      .map((v, m) => `${m === 0 ? 'M' : 'L'}${xScale(m).toFixed(1)},${yScale(v).toFixed(1)}`)
      .join(' ');
  const bandFor = (lower: number[], upper: number[]) => {
    let d = `M${xScale(0).toFixed(1)},${yScale(upper[0]!).toFixed(1)} `;
    for (let m = 1; m < upper.length; m++) {
      d += `L${xScale(m).toFixed(1)},${yScale(upper[m]!).toFixed(1)} `;
    }
    for (let m = lower.length - 1; m >= 0; m--) {
      d += `L${xScale(m).toFixed(1)},${yScale(lower[m]!).toFixed(1)} `;
    }
    return `${d}Z`;
  };

  const lineD = series
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${xScale(p.ageMonths).toFixed(1)},${yScale(p.value).toFixed(1)}`,
    )
    .join(' ');

  const lineColorStrong =
    tone === 'male' ? 'var(--chart-male)' : 'var(--chart-female)';

  return (
    <svg
      data-testid={`growth-sparkline-svg-${metric}`}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block h-[60px] w-full pb-2.5"
      style={{ gridArea: 'svg' }}
    >
      {/* Neutral-tinted percentile band — the cards stay in cool teal
          tones; the sex color is reserved for the patient's line and
          dots. */}
      <path
        d={bandFor(reference.P3, reference.P97)}
        fill="rgba(204,251,241,0.4)"
      />
      <path
        d={lineFor(reference.P50)}
        stroke="var(--teal-600)"
        strokeWidth={1.5}
        fill="none"
      />

      {series.length > 1 ? (
        <path
          d={lineD}
          stroke={lineColorStrong}
          strokeWidth={2}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      {series.map((p, i) => {
        const cx = xScale(p.ageMonths);
        const cy = yScale(p.value);
        const isCurrent = i === series.length - 1;
        return (
          <circle
            key={p.visitId}
            cx={cx}
            cy={cy}
            r={isCurrent ? 3 : 2.5}
            fill={lineColorStrong}
            stroke={isCurrent ? 'var(--bg-elevated)' : 'none'}
            strokeWidth={isCurrent ? 1.5 : 0}
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Empty / placeholder states
// ---------------------------------------------------------------------------

function EmptyState(): ReactElement {
  return (
    <div
      data-testid="growth-empty"
      className="flex flex-col items-center gap-1 px-6 py-7 text-center"
    >
      <span
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-full border border-line bg-surface-subtle text-ink-faint"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 4v16h16" />
          <path d="M8 16l3-4 3 2 5-7" strokeDasharray="2 3" />
        </svg>
      </span>
      <h4 className="text-[14px] font-semibold tracking-snug text-ink-strong">
        Asnjë e dhënë e regjistruar
      </h4>
      <p className="max-w-[260px] text-[12px] text-ink-muted">
        Pesha, gjatësia dhe PK shfaqen pas matjes së parë.
      </p>
    </div>
  );
}

function UnknownSexPlaceholder({
  onRequestSetSex,
}: {
  onRequestSetSex?: () => void;
}): ReactElement {
  return (
    <div
      data-testid="growth-unknown-sex"
      className="flex flex-col items-center gap-2.5 px-5 py-6 text-center"
    >
      <span
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-full border border-line bg-surface-subtle text-ink-faint"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
        </svg>
      </span>
      <p className="max-w-[260px] text-[12.5px] text-ink-muted">
        Përcaktoni gjininë e pacientit për të parë grafikët.
      </p>
      {onRequestSetSex ? (
        <button
          type="button"
          onClick={onRequestSetSex}
          className="inline-flex h-8 items-center rounded-sm border border-line bg-surface-elevated px-3 text-[12.5px] font-medium text-ink-strong hover:bg-surface-subtle"
        >
          Cakto gjininë
        </button>
      ) : null}
    </div>
  );
}
