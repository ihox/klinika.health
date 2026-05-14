// Visit report template — A5 portrait, 1–2 pages.
//
// Page 1 always renders. Page 2 only renders when the visit has linked
// ultrasound studies AND ultrasound findings text. Each page is
// independently signed and stamped — Kosovo practice; doctors sign
// every page that leaves the clinic.
//
// Translated from `design-reference/prototype/print-visit.html`. The
// canonical visibility table in CLAUDE.md governs which fields appear;
// any drift here is a bug.

import {
  escapeHtml,
  formatIsoDateDdMmYyyy,
  formatLengthCm,
  formatTemperatureC,
  formatWeightG,
  formatWeightKg,
  hasText,
} from '../print.format';
import type { VisitReportTemplateData } from '../print.dto';
import {
  renderSignatureColumn,
  renderStampArea,
  wrapDocument,
} from './shared-styles';

export function renderVisitReport(data: VisitReportTemplateData): string {
  const pages = [renderPage1(data)];
  const wantsUltrasoundPage =
    data.ultrasoundImages.length > 0 || hasText(data.ultrasoundNotes);
  if (wantsUltrasoundPage) {
    pages.push(renderPage2(data));
  }
  return wrapDocument(pages.join('\n'), 'Raporti i vizitës');
}

function renderPage1(data: VisitReportTemplateData): string {
  const { clinic, patient, vitals } = data;
  const paymentCell = patient.paymentCode
    ? `<tr><td class="l">Kod · ID</td><td class="v"><span class="pay-letter">${escapeHtml(patient.paymentCode)}</span> · ${
        patient.legacyId != null ? escapeHtml(String(patient.legacyId)) : '—'
      }</td></tr>`
    : '';
  const dobCell = patient.dateOfBirth
    ? `<tr><td class="l">DL</td><td class="v">${escapeHtml(formatIsoDateDdMmYyyy(patient.dateOfBirth))}</td></tr>`
    : '';
  const placeCell = patient.placeOfBirth
    ? `<tr><td class="l">Vendi</td><td class="v">${escapeHtml(patient.placeOfBirth)}</td></tr>`
    : '';
  const birthWeightCell =
    patient.birthWeightG != null
      ? `<tr><td class="l">Pesha lindjes</td><td class="v">${escapeHtml(formatWeightG(patient.birthWeightG))}</td></tr>`
      : '';
  const birthLengthCell =
    patient.birthLengthCm != null
      ? `<tr><td class="l">Gjat. lindjes</td><td class="v">${escapeHtml(formatLengthCm(patient.birthLengthCm))}</td></tr>`
      : '';
  const birthPkCell =
    patient.birthHeadCircumferenceCm != null
      ? `<tr><td class="l">PK lindjes</td><td class="v">${escapeHtml(formatLengthCm(patient.birthHeadCircumferenceCm))}</td></tr>`
      : '';

  const vitalsStrip = renderVitalsStrip(vitals);
  const diagnosisBox = renderDiagnosisBox(data.diagnoses, data.legacyDiagnosis);
  const prescriptionBox = hasText(data.prescription)
    ? `
      <div class="box">
        <div class="lab">Th <span class="full">· Terapia</span></div>
        <div class="tx-content">${escapeHtml(data.prescription).replace(/\n/g, '<br>')}</div>
      </div>
    `
    : '';

  const visitNumberLine =
    data.totalVisits > 0
      ? `Vizita ${data.visitNumber} nga ${data.totalVisits}${data.visitTime ? ' · ' + escapeHtml(data.visitTime) : ''}`
      : data.visitTime
        ? escapeHtml(data.visitTime)
        : '';

  return `
    <style>
      .v-vitals {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        border: 1px solid #D6D3D1;
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 4mm;
      }
      .v-vitals .cell { padding: 3mm 4mm; border-right: 1px solid #E7E5E4; }
      .v-vitals .cell:last-child { border-right: none; }
      .v-vitals .l {
        font-size: 7pt; color: #78716C;
        text-transform: uppercase; letter-spacing: 0.06em; font-weight: 500;
      }
      .v-vitals .v {
        font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
        font-size: 11pt; font-weight: 600;
        font-variant-numeric: tabular-nums; margin-top: 1mm;
      }

      .pt-banner {
        display: flex; justify-content: space-between; align-items: flex-end;
        margin-bottom: 5mm;
      }
      .pt-banner .name {
        font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
        font-size: 16pt; font-weight: 600;
        letter-spacing: -0.015em; line-height: 1;
      }
      .pt-banner .age { font-size: 8.5pt; color: #57534E; margin-top: 3px; }
      .pt-banner .when { text-align: right; font-size: 8pt; color: #57534E; font-variant-numeric: tabular-nums; }
      .pt-banner .when strong { color: #1c1917; font-weight: 600; }

      .doc-body { flex: 1; display: flex; flex-direction: column; gap: 4mm; }

      .dx-list { display: flex; flex-direction: column; gap: 2mm; }
      .dx-line {
        display: grid; grid-template-columns: 22mm 1fr;
        gap: 6mm; font-size: 10pt; align-items: baseline;
      }
      .dx-line .code {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-weight: 600; color: #0F766E; font-size: 9.5pt;
      }
      .dx-line .desc { font-style: italic; }
      .dx-line.primary {
        padding-bottom: 2mm;
        border-bottom: 1px dashed #E7E5E4;
      }
      .dx-line.primary .desc { font-weight: 600; font-style: normal; }
      .dx-legacy {
        font-style: italic; font-size: 10pt;
        color: #1c1917;
      }
      .tx-content {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 9pt; line-height: 1.6; white-space: pre-wrap;
      }
    </style>

    <article class="paper">
      <header class="lh">
        <div>
          <div class="lh-name">
            <span class="lh-formal">${escapeHtml(clinic.formalName)}</span>
            ${escapeHtml(clinic.shortName)}
          </div>
          <div class="lh-meta">
            ${escapeHtml(clinic.address)}, ${escapeHtml(clinic.city)}, Kosovë<br>
            ${clinic.phones.map((p) => escapeHtml(p)).join(' · ')} · ${escapeHtml(clinic.hoursLine)}
          </div>
        </div>
        <div class="lh-patient">
          <table>
            ${paymentCell}
            ${dobCell}
            ${placeCell}
            ${birthWeightCell}
            ${birthLengthCell}
            ${birthPkCell}
          </table>
        </div>
      </header>

      <div class="pt-banner">
        <div>
          <div class="name">${escapeHtml(patient.fullName)}</div>
          <div class="age">${escapeHtml(patient.ageLine)}</div>
        </div>
        <div class="when">
          <div><strong>${escapeHtml(formatIsoDateDdMmYyyy(data.visitDate))}</strong></div>
          ${visitNumberLine ? `<div>${visitNumberLine}</div>` : ''}
        </div>
      </div>

      ${vitalsStrip}

      <div class="doc-body">
        ${diagnosisBox}
        ${prescriptionBox}
      </div>

      <footer class="doc-footer">
        ${renderSignatureColumn(data.signature)}
        ${renderStampArea()}
      </footer>
    </article>
  `;
}

function renderPage2(data: VisitReportTemplateData): string {
  const { clinic, patient } = data;
  const notesBlock = hasText(data.ultrasoundNotes)
    ? `
      <div class="us-notes">
        <div class="lab">US <span class="full">· Gjetjet e ultrazërit</span></div>
        <div class="us-body">${escapeHtml(data.ultrasoundNotes).replace(/\n/g, '<br>')}</div>
      </div>
    `
    : '';

  const imagesGrid =
    data.ultrasoundImages.length > 0
      ? `
        <div class="us-grid">
          ${data.ultrasoundImages
            .slice(0, 4)
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
                <div class="us-cap">
                  <strong>Imazh ${img.index}</strong>
                  <span>${escapeHtml(img.caption)}</span>
                </div>
              </div>
            `,
            )
            .join('')}
        </div>
      `
      : '';

  return `
    <style>
      .lh.compact { padding-bottom: 4mm; margin-bottom: 4mm; }
      .lh.compact .lh-name { font-size: 11pt; }
      .lh.compact .lh-formal { font-size: 6.5pt; }
      .page-tag {
        display: inline-flex; align-items: center; gap: 4px;
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 7pt; color: #78716C; background: #F5F5F4;
        border: 1px solid #E7E5E4; padding: 1.5px 6px; border-radius: 999px;
        text-transform: uppercase; letter-spacing: 0.08em;
      }
      .us-notes { border: 1px solid #D6D3D1; border-radius: 3px; padding: 4mm 5mm; margin-bottom: 4mm; }
      .us-notes .lab {
        font-size: 7.5pt; font-weight: 700; color: #0F766E;
        text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2.5mm;
      }
      .us-notes .lab .full { color: #78716C; font-weight: 500; margin-left: 4px; }
      .us-notes .us-body { font-size: 9.5pt; line-height: 1.55; }
      .us-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
      .us-cell {
        border: 1px solid #E7E5E4; border-radius: 3px;
        padding: 2mm; background: white;
        display: flex; flex-direction: column; gap: 1.5mm;
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
      .doc-body { flex: 1; display: flex; flex-direction: column; gap: 5mm; }
    </style>
    <article class="paper">
      <header class="lh compact">
        <div>
          <div class="lh-name">
            <span class="lh-formal">${escapeHtml(clinic.formalName)}</span>
            ${escapeHtml(clinic.shortName)}
          </div>
          <div class="lh-meta">
            ${escapeHtml(patient.fullName)} ·
            ${patient.legacyId != null ? `ID ${escapeHtml(String(patient.legacyId))} · ` : ''}
            ${escapeHtml(formatIsoDateDdMmYyyy(data.visitDate))}
          </div>
        </div>
        <div class="lh-patient" style="display:flex; align-items:flex-end;">
          <span class="page-tag">Faqe 2 · Ultrazëri</span>
        </div>
      </header>

      <div class="doc-body">
        ${notesBlock}
        ${imagesGrid}
      </div>

      <footer class="doc-footer">
        ${renderSignatureColumn(data.signature)}
        ${renderStampArea()}
      </footer>
    </article>
  `;
}

function renderVitalsStrip(vitals: VisitReportTemplateData['vitals']): string {
  // The strip prints only when at least one vital exists. Per the
  // visibility table, vitals appear on the visit report (box style).
  const cells: Array<{ label: string; value: string }> = [];
  if (vitals.weightKg != null) {
    cells.push({ label: 'Pesha', value: formatWeightKg(vitals.weightKg) });
  }
  if (vitals.heightCm != null) {
    cells.push({ label: 'Gjatësia', value: formatLengthCm(vitals.heightCm) });
  }
  if (vitals.headCircumferenceCm != null) {
    cells.push({ label: 'PK', value: formatLengthCm(vitals.headCircumferenceCm) });
  }
  if (vitals.temperatureC != null) {
    cells.push({ label: 'Temp.', value: formatTemperatureC(vitals.temperatureC) });
  }
  if (cells.length === 0) return '';
  return `
    <div class="v-vitals">
      ${cells
        .map(
          (c) => `
        <div class="cell">
          <div class="l">${escapeHtml(c.label)}</div>
          <div class="v">${escapeHtml(c.value)}</div>
        </div>
      `,
        )
        .join('')}
    </div>
  `;
}

function renderDiagnosisBox(
  diagnoses: VisitReportTemplateData['diagnoses'],
  legacyDiagnosis: string | null,
): string {
  if (diagnoses.length === 0 && !hasText(legacyDiagnosis)) {
    return '';
  }
  const lines = diagnoses
    .map(
      (d) => `
        <div class="dx-line ${d.isPrimary ? 'primary' : ''}">
          <span class="code">${escapeHtml(d.code)}</span>
          <span class="desc">${escapeHtml(d.latinDescription)}</span>
        </div>
      `,
    )
    .join('');
  const legacy =
    diagnoses.length === 0 && hasText(legacyDiagnosis)
      ? `<div class="dx-legacy">${escapeHtml(legacyDiagnosis)}</div>`
      : '';
  return `
    <div class="box">
      <div class="lab">Dg <span class="full">· Diagnoza</span></div>
      <div class="dx-list">
        ${lines}
        ${legacy}
      </div>
    </div>
  `;
}
