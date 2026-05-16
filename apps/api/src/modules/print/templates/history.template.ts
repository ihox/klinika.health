// Patient history template — multi-page A5 portrait.
//
// Translated from `design-reference/prototype/print-history.html`.
//
// Layout (newest visits first):
//   • Page 1..N: visit table — 3 columns
//       1. Data / matjet      — date + time + P/GJ/PK/T stack
//       2. Diagnoza           — primary (bold) + secondaries (italic)
//       3. Terapia / Analizat — stacked Th + An blocks, mono
//   • Page N+1: growth charts — Pesha / Gjatësia / Perimetri
//       kraniometrik, three stacked WHO-style cards
//
// The doctor signs only the LAST page (chart page) per the approved
// design — visit-table pages carry just a small "Faqe X / Y" kicker.
//
// Field visibility:
//   * Right header: name + ID + DOB + birth & today's measurements
//   * Per-visit row: date + time, vitals (P/GJ/PK/T), diagnoses,
//                    therapy text
//   * Excluded: allergies, complaint, examinations, follow-up, etc.

import {
  escapeHtml,
  formatIsoDateDdMmYyyy,
  formatLengthCm,
  formatTemperatureC,
  formatWeightKg,
  hasText,
} from '../print.format';
import type {
  GrowthSeriesPoint,
  HistoryTemplateData,
  HistoryVisitRow,
  PatientHeaderForPrint,
  VisitDiagnosisForPrint,
} from '../print.dto';
import {
  renderIssueBlock,
  renderSignatureColumn,
  wrapDocument,
} from './shared-styles';

// Rows per visit-table page — empirical: with two vitals lines + up
// to two diagnoses + a multi-line therapy text, ~8 rows fit on an A5
// page after the letterhead. We allow a few less than the old 12-row
// budget because each row is now ~2.5× taller than the previous flat
// row layout.
const ROWS_PER_PAGE = 8;

export function renderHistory(data: HistoryTemplateData): string {
  const chunks = chunkVisits(data.visits, ROWS_PER_PAGE);
  // Always render at least one visit-table page (even when empty,
  // so the reader sees the header + "no visits recorded" state).
  if (chunks.length === 0) chunks.push([]);
  // The chart page is always present per the design — even with zero
  // measurements the axes anchor the document's identity.
  const totalPages = chunks.length + 1;

  const pages: string[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    pages.push(
      renderVisitsPage({
        data,
        rows: chunks[i] ?? [],
        pageNumber: i + 1,
        totalPages,
        isFirst: i === 0,
      }),
    );
  }
  pages.push(
    renderChartsPage({
      data,
      pageNumber: totalPages,
      totalPages,
    }),
  );
  return wrapDocument(pages.join('\n'), 'Historia e pacientit');
}

function chunkVisits<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Visits table page
// ---------------------------------------------------------------------------

interface VisitsPageContext {
  data: HistoryTemplateData;
  rows: HistoryVisitRow[];
  pageNumber: number;
  totalPages: number;
  isFirst: boolean;
}

function renderVisitsPage(ctx: VisitsPageContext): string {
  const { data, rows, pageNumber, totalPages, isFirst } = ctx;
  const header = isFirst
    ? renderUnifiedLetterhead(data)
    : renderCompactLetterhead(data, pageNumber, totalPages);
  const contextStrip = isFirst ? renderContextStrip(data) : '';
  const tableBody =
    rows.length === 0
      ? `<tr><td colspan="3" class="empty">Asnjë vizitë e regjistruar.</td></tr>`
      : rows.map(renderVisitRow).join('');
  return `
    <style>${visitPageStyles()}</style>
    <article class="paper">
      ${header}
      ${contextStrip}
      <table class="visits-table">
        <thead>
          <tr>
            <th class="col-when">Data / matjet</th>
            <th class="col-dx">Diagnoza</th>
            <th class="col-tx">Terapia / Analizat</th>
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>
      <div class="page-num">Faqe ${pageNumber} / ${totalPages}</div>
    </article>
  `;
}

function renderContextStrip(data: HistoryTemplateData): string {
  const range = data.visitDateRange
    ? `${formatIsoDateDdMmYyyy(data.visitDateRange.from)} – ${formatIsoDateDdMmYyyy(data.visitDateRange.to)}`
    : '—';
  const label = `${data.visitCount} ${data.visitCount === 1 ? 'vizitë' : 'vizita'}`;
  return `
    <div class="doc-context">
      <div class="dc-l">Historia e pacientit</div>
      <div class="dc-r">${escapeHtml(label)} · ${escapeHtml(range)}</div>
    </div>
  `;
}

function renderVisitRow(v: HistoryVisitRow): string {
  const dateLine = `
    <div class="v-date">${escapeHtml(formatIsoDateDdMmYyyy(v.visitDate))}${
      v.visitTime ? ` <span class="v-time">${escapeHtml(v.visitTime)}</span>` : ''
    }</div>
  `;
  const vitalsLine1 = renderVitalsLine([
    v.weightKg != null ? { lbl: 'P', value: formatWeightKg(v.weightKg) } : null,
    v.heightCm != null
      ? { lbl: 'GJ', value: formatLengthCm(v.heightCm) }
      : null,
  ]);
  const vitalsLine2 = renderVitalsLine([
    v.headCircumferenceCm != null
      ? { lbl: 'PK', value: formatLengthCm(v.headCircumferenceCm) }
      : null,
    v.temperatureC != null
      ? { lbl: 'T', value: formatTemperatureC(v.temperatureC) }
      : null,
  ]);
  const vitals =
    vitalsLine1 || vitalsLine2
      ? `<div class="v-vitals">${vitalsLine1}${vitalsLine1 && vitalsLine2 ? '<br>' : ''}${vitalsLine2}</div>`
      : '';

  const diagCell = renderDiagnosisCell(v.diagnoses, v.legacyDiagnosis);
  const clinicalCell = renderClinicalCell(v);

  return `
    <tr>
      <td class="col-when">${dateLine}${vitals}</td>
      <td class="dx">${diagCell}</td>
      <td class="clinical">${clinicalCell}</td>
    </tr>
  `;
}

function renderVitalsLine(
  cells: ({ lbl: string; value: string } | null)[],
): string {
  const present = cells.filter((c): c is { lbl: string; value: string } => c !== null);
  if (present.length === 0) return '';
  return present
    .map((c) => {
      // Split "13.6 kg" → numeric + unit so we can style them
      // separately (.num bold, .u faint). Numbers always come first.
      const [num, ...unitParts] = c.value.split(' ');
      const unit = unitParts.join(' ');
      return `<span class="lbl">${escapeHtml(c.lbl)}</span><span class="num">${escapeHtml(num ?? '')}</span>${unit ? `<span class="u">${escapeHtml(unit)}</span>` : ''}`;
    })
    .join('<span class="dot">·</span>');
}

function renderDiagnosisCell(
  diagnoses: VisitDiagnosisForPrint[],
  legacyDiagnosis: string | null,
): string {
  if (diagnoses.length === 0 && hasText(legacyDiagnosis)) {
    return `<div class="legacy">${escapeHtml(legacyDiagnosis)}</div>`;
  }
  if (diagnoses.length === 0) {
    return '<span class="dash">—</span>';
  }
  return diagnoses
    .map(
      (d) => `
        <div class="dx-row ${d.isPrimary ? 'primary' : ''}">
          <span class="code">${escapeHtml(d.code)}</span><span class="desc">${escapeHtml(d.latinDescription)}</span>
        </div>
      `,
    )
    .join('');
}

function renderClinicalCell(v: HistoryVisitRow): string {
  // Th block always renders (with em-dash if no prescription). An
  // block is reserved for the analyses field that lands with the lab
  // module — for v1 we don't have a separate analyses column.
  const tx = hasText(v.prescription)
    ? escapeHtml(v.prescription).replace(/\n/g, '<br>')
    : '<span class="dash">—</span>';
  return `<div class="block"><span class="seg-lab">Th</span>${tx}</div>`;
}

// ---------------------------------------------------------------------------
// Growth chart page (always last)
// ---------------------------------------------------------------------------

interface ChartsPageContext {
  data: HistoryTemplateData;
  pageNumber: number;
  totalPages: number;
}

function renderChartsPage(ctx: ChartsPageContext): string {
  const { data, pageNumber, totalPages } = ctx;
  const totalPoints =
    data.growthSeries.weight.length +
    data.growthSeries.height.length +
    data.growthSeries.headCircumference.length;
  const weightRange = summarizeRange(data.growthSeries.weight, 'kg', 1);
  const heightRange = summarizeRange(data.growthSeries.height, 'cm', 0);
  const headRange = summarizeRange(data.growthSeries.headCircumference, 'cm', 1);
  return `
    <style>${chartsPageStyles()}</style>
    <article class="paper">
      ${renderCompactLetterhead(data, pageNumber, totalPages)}
      <div class="doc-context">
        <div class="dc-l">Diagrami i rritjes · WHO</div>
        <div class="dc-r">${totalPoints} pika matëse</div>
      </div>
      <div class="charts-grid">
        ${renderGrowthChart({
          title: 'Pesha · P50',
          rangeSummary: weightRange,
          points: data.growthSeries.weight,
          sex: data.patientSex,
        })}
        ${renderGrowthChart({
          title: 'Gjatësia · P50',
          rangeSummary: heightRange,
          points: data.growthSeries.height,
          sex: data.patientSex,
        })}
        ${renderGrowthChart({
          title: 'Perimetri kraniometrik · P50',
          rangeSummary: headRange,
          points: data.growthSeries.headCircumference,
          sex: data.patientSex,
        })}
      </div>
      <footer class="doc-footer">
        ${renderIssueBlockWithKicker(data, pageNumber, totalPages)}
        ${renderSignatureColumn(data.signature)}
      </footer>
    </article>
  `;
}

function summarizeRange(
  points: GrowthSeriesPoint[],
  unit: string,
  fractionDigits: number,
): string {
  if (points.length === 0) return '—';
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  const delta = last - first;
  const sign = delta >= 0 ? '+' : '';
  const months = approxMonthsBetween(points[0]!.visitDate, points[points.length - 1]!.visitDate);
  const monthsSuffix = months > 0 ? ` / ${months}m` : '';
  return `${first.toFixed(fractionDigits)} → ${last.toFixed(fractionDigits)} ${unit} · ${sign}${delta.toFixed(fractionDigits)} ${unit}${monthsSuffix}`;
}

function approxMonthsBetween(fromIso: string, toIso: string): number {
  // Calendar-month delta, not exact 30-day buckets — matches the
  // "+1.8 kg / 7m" phrasing from the prototype where 7 months means
  // 7 calendar steps.
  const [fy, fm] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  if (!fy || !fm || !ty || !tm) return 0;
  return (ty - fy) * 12 + (tm - fm);
}

interface GrowthChartOpts {
  title: string;
  rangeSummary: string;
  points: GrowthSeriesPoint[];
  sex: 'm' | 'f' | null;
}

function renderGrowthChart(opts: GrowthChartOpts): string {
  const lineColor = sexLineColor(opts.sex);
  const clinicalSvg = renderClinicalLine(opts.points, lineColor);
  return `
    <div class="chart-card">
      <div class="chart-head">
        <div class="chart-title">${escapeHtml(opts.title)}</div>
        <div class="chart-range">${escapeHtml(opts.rangeSummary)}</div>
      </div>
      <svg viewBox="0 0 400 90" preserveAspectRatio="none" class="chart-svg">
        ${WHO_BAND_SVG}
        ${clinicalSvg}
      </svg>
    </div>
  `;
}

function sexLineColor(sex: 'm' | 'f' | null): string {
  // Canonical chart palette tokens from apps/web/app/globals.css —
  // hardcoded here because the print CSS is fully self-contained
  // (no external @import, no CSS variables shared across files).
  if (sex === 'm') return '#4A90D9';
  if (sex === 'f') return '#E8728E';
  return '#0F766E';
}

function renderClinicalLine(points: GrowthSeriesPoint[], color: string): string {
  if (points.length === 0) {
    return `
      <text x="200" y="50" text-anchor="middle"
        fill="#A8A29E" font-family="Inter, sans-serif"
        font-size="9">Pa pika matëse</text>
    `;
  }
  // Scale x linearly across the chart width based on point index.
  // Scale y to the data range with a small padding so the line
  // doesn't kiss the edges. Y is inverted: top = 0, bottom = 90.
  const xs = points.map((_p, i, arr) =>
    arr.length === 1 ? 200 : 20 + (i * (360 / (arr.length - 1))),
  );
  const values = points.map((p) => p.value);
  const yMin = Math.min(...values);
  const yMax = Math.max(...values);
  const range = yMax - yMin || 1;
  const yPx = (v: number) => 80 - ((v - yMin) / range) * 60;
  const ys = values.map(yPx);
  const path = xs
    .map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i]!.toFixed(1)}`)
    .join(' ');
  const dots = xs
    .map(
      (x, i) =>
        `<circle cx="${x.toFixed(1)}" cy="${ys[i]!.toFixed(1)}" r="${i === xs.length - 1 ? 2.6 : 2.2}" fill="${color}"/>`,
    )
    .join('');
  return `
    <path d="${path}" stroke="${color}" stroke-width="1.5" fill="none"/>
    ${dots}
  `;
}

// Static WHO-style percentile band: P50 solid + P15/P85 dashed,
// with a soft teal fill under P50. The exact path is decorative —
// it conveys "this is a growth chart" without claiming real WHO
// LMS data. v2 will wire the proper percentile interpolation per
// age + sex.
const WHO_BAND_SVG = `
  <path d="M 0,75 C 100,68 200,58 300,48 S 400,38 400,38 L 400,90 L 0,90 Z" fill="rgba(204,251,241,0.4)"/>
  <path d="M 0,75 C 100,68 200,58 300,48 S 400,38 400,38" stroke="#14B8A6" stroke-width="1.2" fill="none"/>
  <path d="M 0,85 C 100,80 200,72 300,64 S 400,52 400,52" stroke="#14B8A6" stroke-width="0.7" fill="none" stroke-dasharray="2 2" opacity="0.5"/>
  <path d="M 0,62 C 100,54 200,44 300,32 S 400,18 400,18" stroke="#14B8A6" stroke-width="0.7" fill="none" stroke-dasharray="2 2" opacity="0.5"/>
`;

// ---------------------------------------------------------------------------
// Letterhead / footer shared helpers
// ---------------------------------------------------------------------------

function renderUnifiedLetterhead(data: HistoryTemplateData): string {
  const phonesLine = data.clinic.phones.map((p) => escapeHtml(p)).join(' · ');
  const licenseLine = data.clinic.licenseNumber
    ? `<br><span class="lic">${escapeHtml(data.clinic.licenseNumber)}</span>`
    : '';
  return `
    <header class="lh">
      <div class="lh-clinic">
        <span class="formal">${escapeHtml(data.clinic.formalName)}</span>
        <div class="name">${escapeHtml(data.clinic.shortName)}</div>
        <div class="meta">
          ${escapeHtml(data.clinic.address)}, ${escapeHtml(data.clinic.city)}, Kosovë<br>
          ${phonesLine}<br>
          ${escapeHtml(data.clinic.hoursLine)}${licenseLine}
        </div>
      </div>
      <div class="lh-patient">
        <div class="pt-name">${escapeHtml(data.patient.fullName)}</div>
        ${renderPatientIdLine(data.patient)}
        <div class="pt-meta">
          ${renderDobLine(data.patient)}
          ${renderBirthMeasurementsRow(data.patient)}
          ${renderTodayMeasurementsRow(data.todaySummary)}
        </div>
      </div>
    </header>
  `;
}

function renderCompactLetterhead(
  data: HistoryTemplateData,
  pageNumber: number,
  totalPages: number,
): string {
  return `
    <header class="lh compact">
      <div class="lh-clinic">
        <span class="formal">${escapeHtml(data.clinic.formalName)}</span>
        <div class="name">${escapeHtml(data.clinic.shortName)}</div>
      </div>
      <div class="lh-patient">
        <div class="pt-name">${escapeHtml(data.patient.fullName)}</div>
        ${renderPatientIdLine(data.patient)}
        <div class="pt-meta">
          <div class="row" style="margin-top: 1mm;">
            <span class="page-tag">Faqe ${pageNumber} / ${totalPages} · Vazhdim</span>
          </div>
        </div>
      </div>
    </header>
  `;
}

function renderDobLine(patient: PatientHeaderForPrint): string {
  if (!patient.dateOfBirth) return '';
  return `<div class="row"><span class="k">DL</span><span class="v">${escapeHtml(formatIsoDateDdMmYyyy(patient.dateOfBirth))}</span></div>`;
}

function renderPatientIdLine(patient: PatientHeaderForPrint): string {
  if (patient.legacyId == null && !patient.paymentCode) return '';
  const sigil = patient.paymentCode
    ? `<span class="id-sigil">${escapeHtml(patient.paymentCode)}</span>`
    : '';
  const id =
    patient.legacyId != null ? escapeHtml(String(patient.legacyId)) : '';
  return `<div class="pt-id">${sigil}${id}</div>`;
}

function renderBirthMeasurementsRow(patient: PatientHeaderForPrint): string {
  const parts: string[] = [];
  if (patient.birthWeightG != null) {
    const kg = (patient.birthWeightG / 1000).toFixed(3);
    parts.push(`<span class="bm-l">PL</span>${escapeHtml(kg)}<span class="bm-u">kg</span>`);
  }
  if (patient.birthLengthCm != null) {
    parts.push(
      `<span class="bm-l">GjL</span>${escapeHtml(stripUnitFromCm(patient.birthLengthCm))}<span class="bm-u">cm</span>`,
    );
  }
  if (patient.birthHeadCircumferenceCm != null) {
    parts.push(
      `<span class="bm-l">PKL</span>${escapeHtml(stripUnitFromCm(patient.birthHeadCircumferenceCm))}<span class="bm-u">cm</span>`,
    );
  }
  if (parts.length === 0) return '';
  return `<div class="row measures"><span class="v">${parts.join(' · ')}</span></div>`;
}

function renderTodayMeasurementsRow(
  today: HistoryTemplateData['todaySummary'],
): string {
  if (!today) return '';
  const parts: string[] = [];
  if (today.weightKg != null) {
    parts.push(
      `<span class="bm-l">Pt</span>${escapeHtml(stripUnitFromKg(today.weightKg))}<span class="bm-u">kg</span>`,
    );
  }
  if (today.heightCm != null) {
    parts.push(
      `<span class="bm-l">GjT</span>${escapeHtml(stripUnitFromCm(today.heightCm))}<span class="bm-u">cm</span>`,
    );
  }
  if (today.headCircumferenceCm != null) {
    parts.push(
      `<span class="bm-l">PKT</span>${escapeHtml(stripUnitFromCm(today.headCircumferenceCm))}<span class="bm-u">cm</span>`,
    );
  }
  if (parts.length === 0) return '';
  return `<div class="row measures"><span class="v">${parts.join(' · ')}</span></div>`;
}

function stripUnitFromCm(cm: number): string {
  return formatLengthCm(cm).replace(/\s*cm$/, '');
}

function stripUnitFromKg(kg: number): string {
  return formatWeightKg(kg).replace(/\s*kg$/, '');
}

function renderIssueBlockWithKicker(
  data: HistoryTemplateData,
  pageNumber: number,
  totalPages: number,
): string {
  // The chart-page issue block carries an extra "Faqe N / N" kicker
  // beneath the place line so multi-page prints stay collated.
  const inner = renderIssueBlock(data.signature);
  return inner.replace(
    /<\/div>\s*$/,
    `<div class="issue-meta">Faqe ${pageNumber} / ${totalPages}</div></div>`,
  );
}

// ---------------------------------------------------------------------------
// Inline styles
// ---------------------------------------------------------------------------

function visitPageStyles(): string {
  return `
    .paper { padding: 12mm 12mm 10mm; font-size: 8.5pt; }

    .doc-context {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 0 0 4mm;
      font-size: 7.3pt;
      color: #57534E;
      font-variant-numeric: tabular-nums;
    }
    .doc-context .dc-l {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 11pt;
      font-weight: 700;
      color: #1c1917;
      letter-spacing: 0.01em;
    }
    .doc-context .dc-r {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7pt;
      color: #78716C;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .visits-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5pt;
      font-variant-numeric: tabular-nums;
      table-layout: fixed;
    }
    .visits-table thead th {
      text-align: left;
      padding: 2mm 2.5mm;
      font-size: 6.5pt;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 700;
      color: #0F766E;
      border-bottom: 1.5px solid #0F766E;
    }
    .visits-table tbody td {
      padding: 2mm 2.5mm;
      border-bottom: 1px solid #E7E5E4;
      vertical-align: top;
    }
    .visits-table tbody tr:nth-child(odd) td {
      background: rgba(204, 251, 241, 0.18);
    }

    .visits-table .col-when { width: 28mm; }
    .visits-table .col-dx { width: 34mm; }
    .visits-table .col-tx { width: auto; }

    .visits-table .v-date {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7.5pt;
      color: #1c1917;
      font-weight: 600;
      letter-spacing: 0.01em;
    }
    .visits-table .v-time {
      color: #A8A29E;
      font-weight: 400;
      font-size: 6.6pt;
      margin-left: 1mm;
    }

    .v-vitals {
      margin-top: 1mm;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 6.8pt;
      line-height: 1.4;
      color: #1c1917;
      letter-spacing: -0.005em;
    }
    .v-vitals .num { font-weight: 700; color: #1c1917; }
    .v-vitals .u {
      font-size: 6pt;
      color: #78716C;
      font-weight: 500;
      margin-left: 0.3mm;
    }
    .v-vitals .lbl {
      font-family: 'Inter', sans-serif;
      font-size: 6pt;
      color: #78716C;
      font-weight: 500;
      margin-right: 0.5mm;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .v-vitals .dot { color: #C4C0BC; margin: 0 0.8mm; font-weight: 400; }

    .visits-table td.dx { font-size: 7.5pt; line-height: 1.4; }
    .visits-table td.dx .code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7pt;
      color: #0F766E;
      font-weight: 700;
      margin-right: 1.2mm;
    }
    .visits-table td.dx .desc { font-style: italic; }
    .visits-table td.dx .dx-row + .dx-row { margin-top: 0.6mm; }
    .visits-table td.dx .dx-row.primary .desc {
      font-weight: 600;
      font-style: normal;
    }
    .visits-table td.dx .legacy {
      font-style: italic;
      color: #1c1917;
    }

    .visits-table td.clinical {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 6.7pt;
      color: #1c1917;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    .visits-table td.clinical .block + .block {
      margin-top: 1.5mm;
      padding-top: 1.5mm;
      border-top: 1px dashed rgba(15, 118, 110, 0.18);
    }
    .visits-table td.clinical .seg-lab {
      font-family: 'Inter', sans-serif;
      display: inline-block;
      font-size: 5.8pt;
      font-weight: 700;
      color: #0F766E;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-right: 1.5mm;
      vertical-align: 0.4mm;
    }
    .visits-table .dash { color: #C4C0BC; }
    .visits-table td.empty {
      text-align: center;
      color: #78716C;
      font-style: italic;
      padding: 8mm 0;
    }

    .page-num {
      text-align: left;
      font-size: 6.5pt;
      color: #78716C;
      padding-top: 3mm;
      margin-top: auto;
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.05em;
      border-top: none;
    }

    .page-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 6.3pt;
      color: #78716C;
      background: #F5F5F4;
      border: 1px solid #E7E5E4;
      padding: 1px 5px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
  `;
}

function chartsPageStyles(): string {
  return `
    .paper { padding: 12mm 12mm 10mm; font-size: 8.5pt; }

    .doc-context {
      display: flex; justify-content: space-between; align-items: baseline;
      padding: 0 0 4mm;
      font-size: 7.3pt;
      color: #57534E;
      font-variant-numeric: tabular-nums;
    }
    .doc-context .dc-l {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 10pt;
      font-weight: 700;
      color: #1c1917;
      letter-spacing: 0.01em;
    }
    .doc-context .dc-r {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7pt;
      color: #78716C;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .charts-grid {
      display: grid;
      grid-template-rows: repeat(3, 1fr);
      gap: 4mm;
      margin-bottom: 5mm;
      flex: 1;
    }
    .chart-card {
      border: 1px solid #E7E5E4;
      border-radius: 3px;
      padding: 3mm 4mm;
      display: flex;
      flex-direction: column;
    }
    .chart-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 1.5mm;
    }
    .chart-title {
      font-size: 6.8pt;
      color: #0F766E;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-weight: 700;
    }
    .chart-range {
      font-size: 6.5pt;
      color: #78716C;
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
    }
    .chart-svg {
      width: 100%;
      height: 32mm;
      flex: 1;
    }

    .doc-footer { padding-top: 6mm; }
    .issue-block .issue-meta {
      margin-top: 1.5mm;
      font-size: 6.5pt;
      color: #A8A29E;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      letter-spacing: 0.04em;
    }

    .page-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 6.3pt;
      color: #78716C;
      background: #F5F5F4;
      border: 1px solid #E7E5E4;
      padding: 1px 5px;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
  `;
}

