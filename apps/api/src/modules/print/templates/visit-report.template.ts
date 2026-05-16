// Visit report template — A5 portrait, 1–2 pages.
//
// Page 1 always renders. Page 2 only renders when the visit has linked
// ultrasound studies AND/OR ultrasound findings text. Each page is
// independently signed (no stamp slot) — Kosovo practice: doctors sign
// every page that leaves the clinic; the physical ink stamp is placed
// by hand in the reserved 5×5cm bottom-right area beside the signature.
//
// Translated from `design-reference/prototype/print-visit.html`. The
// canonical visibility table in CLAUDE.md governs which fields appear;
// any drift here is a bug.

import {
  escapeHtml,
  formatIsoDateDdMmYyyy,
  formatLengthCm,
  formatWeightKg,
  hasText,
} from '../print.format';
import type {
  ClinicLetterhead,
  PatientHeaderForPrint,
  VisitReportTemplateData,
  VisitVitalsForPrint,
} from '../print.dto';
import {
  renderIssueBlock,
  renderSignatureColumn,
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
  const diagnosisBox = renderDiagnosisBox(data.diagnoses, data.legacyDiagnosis);
  const prescriptionBox = hasText(data.prescription)
    ? `
      <div class="box">
        <div class="lab">Th</div>
        <div class="notes-content">${escapeHtml(data.prescription).replace(/\n/g, '<br>')}</div>
      </div>
    `
    : '';

  return `
    <style>
      ${page1Styles()}
    </style>
    <article class="paper">
      ${renderLetterhead(data.clinic, data.patient, data.vitals)}

      <div class="doc-body">
        ${diagnosisBox}
        ${prescriptionBox}
      </div>

      <footer class="doc-footer">
        ${renderIssueBlock(data.signature)}
        ${renderSignatureColumn(data.signature)}
      </footer>
    </article>
  `;
}

function renderPage2(data: VisitReportTemplateData): string {
  const notesBlock = hasText(data.ultrasoundNotes)
    ? `
      <div class="box">
        <div class="lab">UL</div>
        <div class="notes-content">${escapeHtml(data.ultrasoundNotes).replace(/\n/g, '<br>')}</div>
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
      ${page2Styles()}
    </style>
    <article class="paper">
      ${renderCompactLetterhead(data.clinic, data.patient)}

      <div class="doc-body">
        ${notesBlock}
        ${imagesGrid}
      </div>

      <footer class="doc-footer">
        ${renderIssueBlock(data.signature)}
        ${renderSignatureColumn(data.signature)}
      </footer>
    </article>
  `;
}

function renderLetterhead(
  clinic: ClinicLetterhead,
  patient: PatientHeaderForPrint,
  vitals: VisitVitalsForPrint,
): string {
  const phonesLine = clinic.phones.map((p) => escapeHtml(p)).join(' · ');
  const licenseLine = clinic.licenseNumber
    ? `<span class="lic">${escapeHtml(clinic.licenseNumber)}</span>`
    : '';
  const idLine = renderPatientIdLine(patient);
  const dobLine = patient.dateOfBirth
    ? `<div class="row"><span class="k">DL</span><span class="v">${escapeHtml(formatIsoDateDdMmYyyy(patient.dateOfBirth))}</span></div>`
    : '';
  const birthRow = renderBirthMeasurementsRow(patient);
  const todayRow = renderTodayMeasurementsRow(vitals);
  return `
    <header class="lh">
      <div class="lh-clinic">
        <span class="formal">${escapeHtml(clinic.formalName)}</span>
        <div class="name">${escapeHtml(clinic.shortName)}</div>
        <div class="meta">
          ${escapeHtml(clinic.address)}, ${escapeHtml(clinic.city)}, Kosovë<br>
          ${phonesLine}<br>
          ${escapeHtml(clinic.hoursLine)}
          ${licenseLine ? `<br>${licenseLine}` : ''}
        </div>
      </div>
      <div class="lh-patient">
        <div class="pt-name">${escapeHtml(patient.fullName)}</div>
        ${idLine}
        <div class="pt-meta">
          ${dobLine}
          ${birthRow}
          ${todayRow}
        </div>
      </div>
    </header>
  `;
}

function renderCompactLetterhead(
  clinic: ClinicLetterhead,
  patient: PatientHeaderForPrint,
): string {
  const idLine = renderPatientIdLine(patient);
  return `
    <header class="lh compact">
      <div class="lh-clinic">
        <span class="formal">${escapeHtml(clinic.formalName)}</span>
        <div class="name">${escapeHtml(clinic.shortName)}</div>
      </div>
      <div class="lh-patient">
        <div class="pt-name">${escapeHtml(patient.fullName)}</div>
        ${idLine}
      </div>
    </header>
  `;
}

function renderPatientIdLine(patient: PatientHeaderForPrint): string {
  // "A15626" — teal sigil for the payment code letter, mono numerals.
  // When no payment code, fall back to just the legacy id.
  if (patient.legacyId == null && !patient.paymentCode) return '';
  const sigil = patient.paymentCode
    ? `<span class="id-sigil">${escapeHtml(patient.paymentCode)}</span>`
    : '';
  const id =
    patient.legacyId != null ? escapeHtml(String(patient.legacyId)) : '';
  return `<div class="pt-id">${sigil}${id}</div>`;
}

function renderBirthMeasurementsRow(patient: PatientHeaderForPrint): string {
  // PL = pesha e lindjes, GjL = gjatësia e lindjes, PKL = perimetri
  // kraniometrik i lindjes. Row hidden when nothing is recorded.
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

function renderTodayMeasurementsRow(vitals: VisitVitalsForPrint): string {
  // Pt = pesha e tashme, GjT = gjatësia e tashme, PKT = perimetri
  // kraniometrik i tashëm. Row hidden when no current vitals.
  const parts: string[] = [];
  if (vitals.weightKg != null) {
    parts.push(
      `<span class="bm-l">Pt</span>${escapeHtml(stripUnitFromKg(vitals.weightKg))}<span class="bm-u">kg</span>`,
    );
  }
  if (vitals.heightCm != null) {
    parts.push(
      `<span class="bm-l">GjT</span>${escapeHtml(stripUnitFromCm(vitals.heightCm))}<span class="bm-u">cm</span>`,
    );
  }
  if (vitals.headCircumferenceCm != null) {
    parts.push(
      `<span class="bm-l">PKT</span>${escapeHtml(stripUnitFromCm(vitals.headCircumferenceCm))}<span class="bm-u">cm</span>`,
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
      <div class="lab">Dg</div>
      <div class="dx-list">
        ${lines}
        ${legacy}
      </div>
    </div>
  `;
}

function page1Styles(): string {
  return `
    .doc-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 4mm;
      margin-top: 4mm;
    }
    .dx-list { display: flex; flex-direction: column; gap: 1.2mm; }
    .dx-line {
      display: grid;
      grid-template-columns: 14mm 1fr;
      gap: 4mm;
      font-size: 9.5pt;
      align-items: baseline;
      line-height: 1.35;
    }
    .dx-line .code {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-weight: 700;
      color: #0F766E;
      font-size: 9pt;
      font-variant-numeric: tabular-nums;
    }
    .dx-line .desc {
      font-style: italic;
      color: #1c1917;
    }
    .dx-line.primary {
      padding-top: 1.2mm;
      margin-top: -0.5mm;
      border-top: 1px solid rgba(15, 118, 110, 0.18);
    }
    .dx-line.primary:first-child {
      border-top: none;
      padding-top: 0;
      margin-top: 0;
    }
    .dx-line.primary .desc {
      font-weight: 600;
      font-style: normal;
    }
    .dx-legacy {
      font-style: italic;
      font-size: 9.5pt;
      color: #1c1917;
    }
    .notes-content {
      font-size: 9pt;
      line-height: 1.55;
      color: #1c1917;
      white-space: pre-wrap;
    }
    .notes-content em {
      color: #57534E;
      font-style: italic;
    }
  `;
}

function page2Styles(): string {
  return `
    .doc-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 5mm;
      margin-top: 4mm;
    }
    .notes-content {
      font-size: 9pt;
      line-height: 1.55;
      color: #1c1917;
      white-space: pre-wrap;
    }
    .notes-content em {
      color: #57534E;
      font-style: italic;
    }
    .us-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3mm;
    }
    .us-cell {
      border: 1px solid #E7E5E4;
      border-radius: 3px;
      padding: 2mm;
      background: white;
      display: flex;
      flex-direction: column;
      gap: 1.5mm;
    }
    .us-cell .us-img {
      height: 38mm;
      border-radius: 2px;
      overflow: hidden;
      background: #0c0a09;
      display: grid;
      place-items: stretch;
    }
    .us-cell .us-img svg {
      width: 100%;
      height: 100%;
      display: block;
    }
    .us-cell .us-cap {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7pt;
      color: #57534E;
    }
    .us-cell .us-cap strong {
      color: #1c1917;
      font-weight: 600;
    }
  `;
}
