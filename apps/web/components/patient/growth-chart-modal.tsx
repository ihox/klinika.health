'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import {
  pointsForMetric,
  sexChipLabel,
  toneForSex,
  type PatientSexCode,
} from '@/lib/growth-chart';
import { formatDob, type ChartGrowthPointDto } from '@/lib/patient-client';
import {
  estimatePercentileLabel,
  getWhoReference,
  type GrowthMetric,
  WHO_METRIC_META,
  WHO_PERCENTILES,
} from '@/lib/who-growth-data/who-growth-data';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  patientName: string;
  patientSex: PatientSexCode;
  growthPoints: readonly ChartGrowthPointDto[];
  initialMetric?: GrowthMetric;
  /** When true, render the modal title as the historical 0-24 mo view. */
  historical?: boolean;
  onClose: () => void;
}

/**
 * Full-size WHO growth chart modal. Three tabs (Pesha / Gjatësia /
 * Perimetri kokës) share one chart canvas — switching tabs swaps the
 * dataset, the y-axis, and the tooltip unit but leaves the layout
 * stable so the doctor's eye doesn't have to re-anchor.
 *
 * Mirrors design-reference/prototype/components/growth-chart-modal.html
 * — same percentile band gradient, same legend, same data table on
 * the right rail, same Standardet e rritjes footer.
 *
 * The chart line and dots follow the sex convention (blue for boys,
 * pink for girls) — see [`growth-chart.ts`](../../lib/growth-chart.ts).
 * The "Djalë" / "Vajzë" chip in the modal header always accompanies
 * the colored chart so a color-blind doctor still has the text label.
 */
export function GrowthChartModal({
  open,
  patientName,
  patientSex,
  growthPoints,
  initialMetric = 'weight',
  historical = false,
  onClose,
}: Props): ReactElement | null {
  const [metric, setMetric] = useState<GrowthMetric>(initialMetric);

  useEffect(() => {
    if (open) setMetric(initialMetric);
  }, [open, initialMetric]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="growth-modal-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-[rgba(28,25,23,0.62)] p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[calc(100vh-48px)] w-full max-w-[1040px] animate-modal-in flex-col overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-modal">
        <Header
          metric={metric}
          onMetricChange={setMetric}
          patientName={patientName}
          patientSex={patientSex}
          historical={historical}
          pointCount={growthPoints.length}
          onClose={onClose}
        />
        <Body
          metric={metric}
          patientSex={patientSex}
          patientName={patientName}
          growthPoints={growthPoints}
        />
        <Footer onClose={onClose} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({
  metric,
  onMetricChange,
  patientName,
  patientSex,
  historical,
  pointCount,
  onClose,
}: {
  metric: GrowthMetric;
  onMetricChange: (m: GrowthMetric) => void;
  patientName: string;
  patientSex: PatientSexCode;
  historical: boolean;
  pointCount: number;
  onClose: () => void;
}): ReactElement {
  const meta = WHO_METRIC_META[metric];
  const tone = toneForSex(patientSex);
  return (
    <header className="flex items-start justify-between gap-4 border-b border-line-soft px-6 pb-3.5 pt-4">
      <div className="min-w-0">
        <h2
          id="growth-modal-title"
          className="m-0 mb-1.5 font-display text-[18px] font-semibold leading-[1.2] tracking-snug text-ink-strong"
        >
          {historical ? 'Historiku 0-24 muaj' : meta.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-[11.5px] leading-snug text-ink-muted">
          <span className="inline-flex items-center gap-1 rounded-xs border border-teal-200 bg-primary-soft px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-teal-800">
            WHO 0–2 vjet
          </span>
          <SexChip sex={patientSex} tone={tone} />
          <Sep />
          <span className="truncate">{patientName}</span>
          <Sep />
          <span>{pointCount} matje</span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div
          className="flex gap-1 rounded-md border border-line bg-surface-subtle p-[3px]"
          role="tablist"
          aria-label="Tregues"
        >
          {(['weight', 'length', 'hc'] as const).map((m) => {
            const active = metric === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                data-metric={m}
                onClick={() => onMetricChange(m)}
                className={cn(
                  'whitespace-nowrap rounded-xs px-3 py-1.5 text-[12.5px] transition-all',
                  active
                    ? 'bg-surface-elevated font-medium text-ink-strong shadow-xs'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                {WHO_METRIC_META[m].shortTitle}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Mbyll"
          className="grid h-[30px] w-[30px] place-items-center rounded-sm text-[22px] leading-none text-ink-muted hover:bg-surface-subtle hover:text-ink"
        >
          ×
        </button>
      </div>
    </header>
  );
}

function Sep() {
  return (
    <span aria-hidden className="text-line-strong">
      ·
    </span>
  );
}

/**
 * "Djalë" / "Vajzë" chip — always shown alongside the colored chart
 * line. Color is the primary signal, the text label is the
 * accessibility backup for color-blind doctors.
 */
function SexChip({
  sex,
  tone,
}: {
  sex: PatientSexCode;
  tone: 'male' | 'female';
}): ReactElement {
  return (
    <span
      data-testid="growth-modal-sex-chip"
      data-tone={tone}
      className={cn(
        'inline-flex items-center rounded-xs border px-2 py-px text-[11px] font-semibold',
        tone === 'male'
          ? 'border-chart-male-border bg-chart-male-bg text-chart-male'
          : 'border-chart-female-border bg-chart-female-bg text-chart-female',
      )}
    >
      {sexChipLabel(sex)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Body — chart canvas + side rail
// ---------------------------------------------------------------------------

function Body({
  metric,
  patientSex,
  patientName,
  growthPoints,
}: {
  metric: GrowthMetric;
  patientSex: PatientSexCode;
  patientName: string;
  growthPoints: readonly ChartGrowthPointDto[];
}): ReactElement {
  const reference = getWhoReference(metric, patientSex);
  const series = useMemo(
    () => pointsForMetric(growthPoints, metric, 'all'),
    [growthPoints, metric],
  );
  const meta = WHO_METRIC_META[metric];
  const tone = toneForSex(patientSex);
  const lineColorStrong =
    tone === 'male' ? 'var(--chart-male)' : 'var(--chart-female)';

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_240px] overflow-hidden">
      <ChartCanvas
        metric={metric}
        reference={reference}
        series={series.points}
        lineColorStrong={lineColorStrong}
        patientName={patientName}
      />
      <SideRail
        metric={metric}
        reference={reference}
        series={series.points}
        meta={meta}
        tone={tone}
        patientName={patientName}
      />
    </div>
  );
}

interface ChartPoint {
  visitId: string;
  ageMonths: number;
  value: number;
  visitDate: string;
}

// ---------------------------------------------------------------------------
// SVG chart canvas
// ---------------------------------------------------------------------------

const CHART_VIEWBOX = { w: 760, h: 460 };
const CHART_MARGIN = { top: 24, right: 56, bottom: 46, left: 56 };

function ChartCanvas({
  metric,
  reference,
  series,
  lineColorStrong,
  patientName,
}: {
  metric: GrowthMetric;
  reference: ReturnType<typeof getWhoReference>;
  series: ChartPoint[];
  lineColorStrong: string;
  patientName: string;
}): ReactElement {
  const meta = WHO_METRIC_META[metric];
  const { w, h } = CHART_VIEWBOX;
  const innerW = w - CHART_MARGIN.left - CHART_MARGIN.right;
  const innerH = h - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const xScale = (m: number) =>
    CHART_MARGIN.left + (m / 24) * innerW;
  const yScale = (v: number) =>
    CHART_MARGIN.top +
    ((meta.yMax - v) / (meta.yMax - meta.yMin)) * innerH;

  const lineFor = (arr: number[]) => {
    let d = '';
    for (let m = 0; m < arr.length; m++) {
      const cmd = m === 0 ? 'M' : 'L';
      d += `${cmd}${xScale(m).toFixed(1)},${yScale(arr[m]!).toFixed(1)} `;
    }
    return d.trim();
  };
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

  const yTicks: number[] = [];
  for (let v = meta.yMin; v <= meta.yMax; v += meta.yStep) yTicks.push(v);
  const xTicks: number[] = [];
  for (let m = 0; m <= 24; m += 3) xTicks.push(m);

  const lineD = series.length
    ? series
        .map(
          (p, i) =>
            `${i === 0 ? 'M' : 'L'}${xScale(p.ageMonths).toFixed(1)},${yScale(p.value).toFixed(1)}`,
        )
        .join(' ')
    : '';

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<
    | { visitDate: string; value: number; ageMonths: number; pct: string; x: number; y: number }
    | null
  >(null);

  // The scales aren't memoised, so call them inline here instead of
  // closing over the (always-fresh) function identities. The hook only
  // needs to invalidate when the semantic inputs change — `reference`
  // (sex/metric series) and `meta` (axis bounds).
  const showTooltip = (point: ChartPoint) => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const rect = svg.getBoundingClientRect();
    const wrapRect = wrap.getBoundingClientRect();
    const ratio = rect.width / w;
    const cx = xScale(point.ageMonths);
    const cy = yScale(point.value);
    setTooltip({
      visitDate: point.visitDate,
      value: point.value,
      ageMonths: point.ageMonths,
      pct: estimatePercentileLabel(reference, point.ageMonths, point.value),
      x: rect.left - wrapRect.left + cx * ratio,
      y: rect.top - wrapRect.top + cy * ratio,
    });
  };

  return (
    <div
      ref={wrapRef}
      className="relative overflow-auto bg-surface-elevated px-6 pb-5 pt-4"
      style={{
        backgroundImage:
          'linear-gradient(to bottom, rgba(204,251,241,0.10), transparent 30%)',
      }}
    >
      <svg
        ref={svgRef}
        data-testid="growth-modal-chart"
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="xMidYMid meet"
        className="mx-auto block h-auto w-full max-w-[760px]"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Percentile bands — paint outer (P3..P15 + P85..P97) first, inner
            (P15..P85) over the top so the median curve sits on the richer
            tone. Order matters: WHO band hierarchy is what the printed
            chart looks like, and the doctor expects the same visual cue. */}
        <path d={bandFor(reference.P3, reference.P15)} fill="rgba(94,234,212,0.13)" />
        <path d={bandFor(reference.P85, reference.P97)} fill="rgba(94,234,212,0.13)" />
        <path d={bandFor(reference.P15, reference.P85)} fill="rgba(94,234,212,0.22)" />

        {/* Grid + ticks */}
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line
              x1={CHART_MARGIN.left}
              y1={yScale(v)}
              x2={w - CHART_MARGIN.right}
              y2={yScale(v)}
              stroke="rgba(28,25,23,0.05)"
            />
            <text
              x={CHART_MARGIN.left - 8}
              y={yScale(v) + 4}
              textAnchor="end"
              className="fill-ink-faint font-mono text-[11px]"
            >
              {v}
            </text>
          </g>
        ))}
        {xTicks.map((m) => (
          <g key={`x-${m}`}>
            <line
              x1={xScale(m)}
              y1={CHART_MARGIN.top}
              x2={xScale(m)}
              y2={h - CHART_MARGIN.bottom}
              stroke="rgba(28,25,23,0.05)"
            />
            <text
              x={xScale(m)}
              y={h - CHART_MARGIN.bottom + 18}
              textAnchor="middle"
              className="fill-ink-faint font-mono text-[11px]"
            >
              {m}
            </text>
          </g>
        ))}

        {/* Axis labels */}
        <text
          x={CHART_MARGIN.left}
          y={14}
          className="fill-ink-faint text-[10.5px] font-medium uppercase tracking-[0.04em]"
        >
          {meta.unit}
        </text>
        <text
          x={w - CHART_MARGIN.right}
          y={h - 8}
          textAnchor="end"
          className="fill-ink-faint text-[10.5px] font-medium uppercase tracking-[0.04em]"
        >
          MUAJ
        </text>

        {/* Percentile lines: P3/P97 thin teal, P15/P85 dashed, P50 solid. */}
        {(['P3', 'P97'] as const).map((k) => (
          <path
            key={k}
            data-percentile={k}
            d={lineFor(reference[k])}
            stroke="rgba(94,234,212,0.65)"
            strokeWidth={1.3}
            fill="none"
          />
        ))}
        {(['P15', 'P85'] as const).map((k) => (
          <path
            key={k}
            data-percentile={k}
            d={lineFor(reference[k])}
            stroke="rgba(45,212,191,0.55)"
            strokeWidth={1}
            strokeDasharray="3 3"
            fill="none"
          />
        ))}
        <path
          data-percentile="P50"
          d={lineFor(reference.P50)}
          stroke="var(--teal-600)"
          strokeWidth={1.8}
          fill="none"
        />

        {/* Right-edge labels — paint after the lines so they sit on top. */}
        {WHO_PERCENTILES.map((k) => {
          const series = reference[k];
          const last = series[series.length - 1] ?? 0;
          return (
            <text
              key={`label-${k}`}
              x={w - CHART_MARGIN.right + 6}
              y={yScale(last) + 3}
              className="fill-teal-700 font-mono text-[10px] font-semibold"
            >
              {k}
            </text>
          );
        })}

        {/* Patient line + dots */}
        {series.length > 1 ? (
          <path
            data-testid="patient-line"
            d={lineD}
            stroke={lineColorStrong}
            strokeWidth={2.2}
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
            <g
              key={p.visitId}
              data-testid="patient-point"
              data-visit-id={p.visitId}
              data-current={isCurrent ? 'true' : 'false'}
              onMouseEnter={() => showTooltip(p)}
            >
              <circle
                cx={cx}
                cy={cy}
                r={11}
                fill="transparent"
                style={{ cursor: 'pointer', pointerEvents: 'auto' }}
              />
              <circle
                cx={cx}
                cy={cy}
                r={isCurrent ? 5 : 4}
                fill={isCurrent ? lineColorStrong : 'var(--bg-elevated)'}
                stroke={lineColorStrong}
                strokeWidth={2}
              />
            </g>
          );
        })}

        {/* SR-only screen reader summary so a JAWS user gets the same
            point list a sighted user reads off the right-rail table. */}
        <title>{`Grafiku WHO — ${meta.title} për ${patientName}, ${series.length} matje.`}</title>
      </svg>

      {tooltip ? (
        <div
          role="tooltip"
          data-testid="growth-modal-tooltip"
          className="pointer-events-none absolute z-10 rounded-sm bg-ink-strong px-2.5 py-2 text-[11.5px] leading-snug text-white shadow-lg"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, calc(-100% - 10px))',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          <span>
            Data: {formatDob(tooltip.visitDate)} · Vlera:{' '}
            <strong>
              {formatValue(metric, tooltip.value)} {meta.unit}
            </strong>
          </span>
          <span className="mt-px block text-[10.5px] text-white/60">
            Mosha: {tooltip.ageMonths} muaj · {tooltip.pct}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function formatValue(metric: GrowthMetric, value: number): string {
  if (metric === 'weight') {
    return value.toFixed(value < 10 ? 2 : 1);
  }
  return value.toFixed(1);
}

// ---------------------------------------------------------------------------
// Side rail — current pill, legend, data table
// ---------------------------------------------------------------------------

function SideRail({
  metric,
  reference,
  series,
  meta,
  tone,
  patientName,
}: {
  metric: GrowthMetric;
  reference: ReturnType<typeof getWhoReference>;
  series: ChartPoint[];
  meta: (typeof WHO_METRIC_META)[GrowthMetric];
  tone: 'male' | 'female';
  patientName: string;
}): ReactElement {
  const last = series[series.length - 1] ?? null;
  return (
    <aside className="flex flex-col gap-5 overflow-y-auto border-l border-line bg-surface-subtle px-5 py-4">
      <section>
        <SectionTitle>Matja e fundit</SectionTitle>
        {last ? (
          <div className="rounded-md border border-line bg-surface-elevated px-3 py-3">
            <div
              className="font-display text-[22px] font-semibold leading-none tracking-tight tabular-nums text-ink-strong"
              data-testid="growth-modal-current-value"
            >
              {formatValue(metric, last.value)}
              <small className="ml-0.5 text-[12px] font-normal text-ink-faint">
                {meta.unit}
              </small>
            </div>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-pill border border-teal-200 bg-primary-soft px-2 py-0.5 text-[12px] font-semibold text-teal-800 tabular-nums">
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  tone === 'male' ? 'bg-chart-male' : 'bg-chart-female',
                )}
                aria-hidden
              />
              {estimatePercentileLabel(reference, last.ageMonths, last.value)}
            </span>
          </div>
        ) : (
          <div className="rounded-md border border-line border-dashed bg-surface-elevated px-3 py-3 text-[12px] text-ink-muted">
            Asnjë matje e regjistruar.
          </div>
        )}
      </section>

      <section>
        <SectionTitle>Legjenda</SectionTitle>
        <ul className="flex flex-col gap-1.5 text-[12px] text-ink-muted">
          <li className="flex items-center gap-2">
            <span className="flex w-5 items-center justify-center">
              <span className="block h-[1.5px] w-[18px] rounded-sm bg-teal-300" />
            </span>
            P3 / P97 <span className="text-ink-faint">— kufijtë</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="flex w-5 items-center justify-center">
              <span className="block h-0 w-[18px] border-t-[1.5px] border-dashed border-teal-400" />
            </span>
            P15 / P85
          </li>
          <li className="flex items-center gap-2">
            <span className="flex w-5 items-center justify-center">
              <span className="block h-[2px] w-[18px] rounded-sm bg-teal-600" />
            </span>
            P50 <span className="text-ink-faint">— mesatarja</span>
          </li>
          <li className="flex items-center gap-2">
            <span className="flex w-5 items-center justify-center">
              <span
                className={cn(
                  'block h-2 w-2 rounded-full',
                  tone === 'male' ? 'bg-chart-male' : 'bg-chart-female',
                )}
              />
            </span>
            {patientName.split(' ')[0] ?? 'Pacienti'}{' '}
            <span className="text-ink-faint">
              — {tone === 'male' ? 'djalë' : 'vajzë'}
            </span>
          </li>
        </ul>
      </section>

      <section>
        <SectionTitle>Të dhënat</SectionTitle>
        {series.length > 0 ? (
          <div
            data-testid="growth-modal-table"
            className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1.5 text-[12px] tabular-nums"
          >
            <span className="border-b border-line pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              Data
            </span>
            <span className="border-b border-line pb-1 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              {meta.unit}
            </span>
            <span className="border-b border-line pb-1 text-right text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
              P
            </span>
            {[...series].reverse().map((p) => (
              <ReactFragmentRow
                key={p.visitId}
                date={formatDob(p.visitDate)}
                value={`${formatValue(metric, p.value)} ${meta.unit}`}
                pct={estimatePercentileLabel(reference, p.ageMonths, p.value)}
              />
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-ink-muted">Asnjë matje e regjistruar.</p>
        )}
      </section>
    </aside>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
      {children}
    </h4>
  );
}

function ReactFragmentRow({
  date,
  value,
  pct,
}: {
  date: string;
  value: string;
  pct: string;
}): ReactElement {
  return (
    <>
      <span className="text-ink">{date}</span>
      <span className="text-right text-ink">{value}</span>
      <span className="text-right font-medium text-teal-700">{pct}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <footer className="flex items-center justify-between border-t border-line bg-surface-subtle px-6 py-3">
      <span className="text-[11.5px] text-ink-faint">
        Standardet e rritjes · WHO Child Growth Standards (referencë)
      </span>
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex h-8 items-center rounded-sm border border-line bg-surface-elevated px-3 text-[12.5px] font-medium text-ink-strong hover:bg-surface-subtle"
        >
          Printo grafikun
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 items-center rounded-sm border border-transparent bg-primary px-3 text-[12.5px] font-medium text-white shadow-btn-primary-inset hover:bg-primary-dark"
        >
          Mbyll
        </button>
      </div>
    </footer>
  );
}
