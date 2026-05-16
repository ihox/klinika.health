// Patient history template — multi-page A5 portrait.
//
// Translated from `design-reference/prototype/print-history.html`.
//
// Field visibility:
//   * Master row: name + age + DOB, birth measurements, today summary
//   * Per-visit row: Data · Pesha · Diagnoza · Terapia
//   * Ultrasound appendix: only when `includeUltrasound` is true
//
// Pagination: 12 visits per page (empirically fits the A5 height
// without overflow given the 2.5mm row padding and 8pt text). The
// summary block + table head land on page 1; further pages repeat
// the compact header.

import {
  escapeHtml,
  formatIsoDateDdMmYyyy,
  formatLengthCm,
  formatWeightG,
  formatWeightKg,
  hasText,
} from '../print.format';
import type { HistoryTemplateData, HistoryVisitRow } from '../print.dto';
import {
  renderIssueBlock,
  renderSignatureColumn,
  wrapDocument,
} from './shared-styles';

const ROWS_PER_PAGE = 12;

export function renderHistory(data: HistoryTemplateData): string {
  const totalPages = computeTotalPages(data);
  const pages: string[] = [];
  const chunks = chunkVisits(data.visits, ROWS_PER_PAGE);
  if (chunks.length === 0) {
    // No visits → still render a single page with the master block
    // and the empty-state note. Reprints of a fresh chart shouldn't
    // crash the renderer.
    chunks.push([]);
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const isFirst = i === 0;
    const isLast = i === chunks.length - 1 && !data.includeUltrasound;
    pages.push(
      renderHistoryPage({
        data,
        rows: chunks[i] ?? [],
        pageNumber: i + 1,
        totalPages,
        isFirst,
        isLast,
      }),
    );
  }
  if (data.includeUltrasound && data.ultrasoundAppendix.length > 0) {
    pages.push(
      renderUltrasoundAppendix({
        data,
        pageNumber: chunks.length + 1,
        totalPages,
      }),
    );
  }
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

function computeTotalPages(data: HistoryTemplateData): number {
  const visitPages = Math.max(1, Math.ceil(data.visits.length / ROWS_PER_PAGE));
  const usPage =
    data.includeUltrasound && data.ultrasoundAppendix.length > 0 ? 1 : 0;
  return visitPages + usPage;
}

interface HistoryPageContext {
  data: HistoryTemplateData;
  rows: HistoryVisitRow[];
  pageNumber: number;
  totalPages: number;
  isFirst: boolean;
  isLast: boolean;
}

function renderHistoryPage(ctx: HistoryPageContext): string {
  const { data, rows, pageNumber, totalPages, isFirst, isLast } = ctx;
  const header = renderHeader(data, pageNumber);
  const masterBlock = isFirst ? renderMasterBlock(data) : '';
  const tableHead = renderTableHead();
  const rowsHtml = rows.length === 0
    ? `<tr><td colspan="4" class="empty">Asnjë vizitë e regjistruar.</td></tr>`
    : rows.map(renderVisitRow).join('');
  const footer = isLast ? renderFooter(data) : '';
  return `
    <style>
      ${pageStyles()}
    </style>
    <article class="paper">
      ${header}
      ${masterBlock}
      <table class="visits-table">
        ${tableHead}
        <tbody>${rowsHtml}</tbody>
      </table>
      ${footer}
      <div class="page-num">Faqe ${pageNumber}/${totalPages} · ${escapeHtml(data.clinic.shortName)} · ${escapeHtml(data.patientIdLabel)}</div>
    </article>
  `;
}

function renderHeader(data: HistoryTemplateData, page: number): string {
  return `
    <header class="h-header">
      <div class="h-clinic">
        <svg width="24" height="24" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M32 54 C 12 40, 8 26, 18 18 C 24 14, 30 16, 32 22 C 34 16, 40 14, 46 18 C 56 26, 52 40, 32 54 Z" fill="none" stroke="#0F766E" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 34 L 22 34 L 26 28 L 30 40 L 34 30 L 38 36 L 54 36" stroke="#0F766E" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
        </svg>
        <div>
          <div class="h-name">${escapeHtml(data.clinic.shortName)}</div>
          <div class="h-sub">${escapeHtml(data.clinic.city)} · ${escapeHtml(data.clinic.phones[0] ?? '')}</div>
        </div>
      </div>
      <div class="h-meta">
        <div class="h-pt-id">${escapeHtml(data.patientIdLabel)}</div>
        ${page === 1 ? `<div>E lëshuar ${escapeHtml(data.signature.issuedAtDateTime)} · ${escapeHtml(data.signature.issuedPlace)}</div>` : '<div>Vazhdim</div>'}
      </div>
    </header>
  `;
}

function renderMasterBlock(data: HistoryTemplateData): string {
  const { patient, todaySummary } = data;
  const range = data.visitDateRange
    ? `${formatIsoDateDdMmYyyy(data.visitDateRange.from)} – ${formatIsoDateDdMmYyyy(data.visitDateRange.to)}`
    : '—';
  const visitsLabel = `${data.visitCount} ${data.visitCount === 1 ? 'vizitë' : 'vizita'}`;
  const lindjaCell = renderLindjaCell(patient);
  const sotCell = todaySummary ? renderSotCell(todaySummary) : '';
  return `
    <div class="h-title-bar">
      <div>
        <div class="h-title">HISTORIA E PACIENTIT</div>
        <div class="h-subt">${visitsLabel} · ${escapeHtml(range)}</div>
      </div>
    </div>
    <div class="h-master">
      <div class="col">
        <div class="l">Pacienti</div>
        <div class="v name">${escapeHtml(patient.fullName)}</div>
        <div class="sub">${escapeHtml(patient.ageLine)}${patient.dateOfBirth ? ' · lindur ' + escapeHtml(formatIsoDateDdMmYyyy(patient.dateOfBirth)) : ''}</div>
      </div>
      ${lindjaCell}
      ${sotCell}
    </div>
  `;
}

function renderLindjaCell(patient: HistoryTemplateData['patient']): string {
  if (
    patient.birthWeightG == null &&
    patient.birthLengthCm == null &&
    patient.birthHeadCircumferenceCm == null &&
    !patient.placeOfBirth
  ) {
    return '';
  }
  const wL =
    patient.birthWeightG != null && patient.birthLengthCm != null
      ? `${formatWeightG(patient.birthWeightG)} · ${formatLengthCm(patient.birthLengthCm)}`
      : patient.birthWeightG != null
        ? formatWeightG(patient.birthWeightG)
        : patient.birthLengthCm != null
          ? formatLengthCm(patient.birthLengthCm)
          : '—';
  const sub: string[] = [];
  if (patient.birthHeadCircumferenceCm != null) {
    sub.push(`PK ${formatLengthCm(patient.birthHeadCircumferenceCm)}`);
  }
  if (patient.placeOfBirth) sub.push(escapeHtml(patient.placeOfBirth));
  return `
    <div class="col">
      <div class="l">Lindja</div>
      <div class="v">${escapeHtml(wL)}</div>
      ${sub.length > 0 ? `<div class="sub">${sub.join(' · ')}</div>` : ''}
    </div>
  `;
}

function renderSotCell(summary: { weightKg: number | null; heightCm: number | null }): string {
  if (summary.weightKg == null && summary.heightCm == null) return '';
  const main =
    summary.weightKg != null && summary.heightCm != null
      ? `${formatWeightKg(summary.weightKg)} · ${formatLengthCm(summary.heightCm)}`
      : summary.weightKg != null
        ? formatWeightKg(summary.weightKg)
        : summary.heightCm != null
          ? formatLengthCm(summary.heightCm)
          : '—';
  return `
    <div class="col">
      <div class="l">Sot</div>
      <div class="v">${escapeHtml(main)}</div>
    </div>
  `;
}

function renderTableHead(): string {
  return `
    <thead>
      <tr>
        <th>Data</th>
        <th>Pesha</th>
        <th>Diagnoza</th>
        <th>Terapia</th>
      </tr>
    </thead>
  `;
}

function renderVisitRow(v: HistoryVisitRow): string {
  const diagCells =
    v.diagnoses.length > 0
      ? v.diagnoses
          .map(
            (d) => `
              <div><span class="code">${escapeHtml(d.code)}</span><span class="desc">${escapeHtml(d.latinDescription)}</span></div>
            `,
          )
          .join('')
      : hasText(v.legacyDiagnosis)
        ? `<div class="legacy">${escapeHtml(v.legacyDiagnosis)}</div>`
        : '<span class="dash">—</span>';
  const tx = hasText(v.prescription)
    ? escapeHtml(v.prescription).replace(/\n/g, '<br>')
    : '<span class="dash">—</span>';
  return `
    <tr>
      <td class="date">${escapeHtml(formatIsoDateDdMmYyyy(v.visitDate))}</td>
      <td class="weight">${v.weightKg != null ? escapeHtml(formatWeightKg(v.weightKg)) : '<span class="dash">—</span>'}</td>
      <td class="dx">${diagCells}</td>
      <td class="tx">${tx}</td>
    </tr>
  `;
}

function renderFooter(data: HistoryTemplateData): string {
  return `
    <footer class="doc-footer">
      ${renderIssueBlock(data.signature)}
      ${renderSignatureColumn(data.signature)}
    </footer>
  `;
}

function renderUltrasoundAppendix(ctx: {
  data: HistoryTemplateData;
  pageNumber: number;
  totalPages: number;
}): string {
  const { data, pageNumber, totalPages } = ctx;
  const header = renderHeader(data, pageNumber);
  const images = data.ultrasoundAppendix
    .map(
      (img) => `
      <div class="us-cell">
        <div class="us-img">
          <svg viewBox="0 0 200 100" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
            <rect width="200" height="100" fill="#0c0a09"/>
            <path d="M 100 5 L 195 95 L 5 95 Z" fill="#161311"/>
            <ellipse cx="100" cy="55" rx="36" ry="24" fill="#27241f"/>
            <text x="8" y="12" fill="#a8a29e" font-family="JetBrains Mono, monospace" font-size="6">${escapeHtml(img.metaLine)}</text>
          </svg>
        </div>
        <div class="us-cap"><strong>Imazh ${img.index}</strong><span>${escapeHtml(img.caption)}</span></div>
      </div>
    `,
    )
    .join('');
  return `
    <style>${pageStyles()}</style>
    <article class="paper">
      ${header}
      <div class="h-title-bar"><div class="h-title">ULTRAZËRI · ARKIV</div></div>
      <div class="us-grid">${images}</div>
      ${renderFooter(data)}
      <div class="page-num">Faqe ${pageNumber}/${totalPages} · ${escapeHtml(data.clinic.shortName)} · ${escapeHtml(data.patientIdLabel)}</div>
    </article>
  `;
}

function pageStyles(): string {
  return `
    .paper { padding: 12mm 12mm 10mm; font-size: 8.5pt; }
    .h-header {
      display: flex; justify-content: space-between; align-items: center;
      padding-bottom: 4mm; border-bottom: 1.5px solid #0F766E; margin-bottom: 4mm;
    }
    .h-clinic { display: flex; align-items: center; gap: 3mm; }
    .h-clinic .h-name {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 11pt; font-weight: 700; color: #0F766E; line-height: 1;
    }
    .h-clinic .h-sub { font-size: 7pt; color: #57534E; margin-top: 1mm; }
    .h-meta {
      text-align: right; font-size: 7.5pt; color: #57534E;
      font-variant-numeric: tabular-nums;
    }
    .h-pt-id { font-weight: 600; color: #1c1917; }

    .h-title-bar { margin-bottom: 5mm; }
    .h-title {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 13pt; font-weight: 700; letter-spacing: -0.005em;
    }
    .h-subt { font-size: 8pt; color: #57534E; }

    .h-master {
      background: #F5F5F4; border: 1px solid #E7E5E4; border-radius: 3px;
      padding: 3mm 4mm; margin-bottom: 5mm;
      display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 5mm;
    }
    .h-master .col .l {
      font-size: 6.5pt; color: #78716C;
      text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;
    }
    .h-master .col .v {
      font-size: 9pt; font-weight: 600; font-variant-numeric: tabular-nums; margin-top: 1mm;
    }
    .h-master .col .v.name {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 11pt;
    }
    .h-master .col .sub { font-size: 7.5pt; color: #57534E; margin-top: 1mm; }

    .visits-table {
      width: 100%; border-collapse: collapse;
      font-size: 8pt; font-variant-numeric: tabular-nums;
    }
    .visits-table thead th {
      text-align: left; padding: 2.5mm 3mm; font-size: 7pt;
      text-transform: uppercase; letter-spacing: 0.08em;
      font-weight: 700; color: #0F766E;
      border-bottom: 1.5px solid #0F766E;
    }
    .visits-table td {
      padding: 2.5mm 3mm; border-bottom: 1px solid #E7E5E4; vertical-align: top;
    }
    .visits-table tbody tr:nth-child(odd) td { background: rgba(204,251,241,0.18); }
    .visits-table td.date {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7.5pt; color: #57534E; width: 18mm;
    }
    .visits-table td.weight { width: 16mm; color: #1c1917; font-weight: 600; }
    .visits-table td.dx { font-size: 8pt; }
    .visits-table td.dx .code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7.5pt; color: #0F766E; font-weight: 700; margin-right: 2mm;
    }
    .visits-table td.dx .desc { font-style: italic; }
    .visits-table td.dx .legacy { font-style: italic; color: #1c1917; }
    .visits-table td.tx {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7pt; color: #1c1917; line-height: 1.5; white-space: pre-wrap;
    }
    .visits-table td.empty {
      text-align: center; color: #78716C; font-style: italic; padding: 8mm 0;
    }
    .visits-table .dash { color: #C4C0BC; }

    .doc-footer {
      margin-top: auto; padding-top: 6mm;
      display: flex; justify-content: space-between; align-items: flex-end; gap: 6mm;
    }

    .us-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-bottom: 6mm;
    }
    .us-cell {
      border: 1px solid #E7E5E4; border-radius: 3px;
      padding: 2mm; display: flex; flex-direction: column; gap: 1.5mm;
    }
    .us-cell .us-img {
      height: 38mm; border-radius: 2px; overflow: hidden;
      background: #0c0a09; display: grid; place-items: stretch;
    }
    .us-cell .us-img svg { width: 100%; height: 100%; display: block; }
    .us-cell .us-cap {
      display: flex; justify-content: space-between; align-items: baseline;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7pt; color: #57534E;
    }
    .us-cell .us-cap strong { color: #1c1917; font-weight: 600; }
  `;
}
