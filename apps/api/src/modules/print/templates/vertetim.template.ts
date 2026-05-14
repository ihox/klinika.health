// Vërtetim template — A5 portrait, single page.
//
// Translated from `design-reference/prototype/print-certificate.html`.
// Field visibility per the canonical table:
//   master data — name + DOB + place only (no allergies, no payment code)
//   date — issue date
//   diagnosis — from frozen `diagnosis_snapshot` (NOT live visit)
//   period — from absence_from / absence_to
//
// No allergies, no vitals, no therapy, no examinations.

import {
  escapeHtml,
  formatIsoDateDdMmYyyy,
  hasText,
} from '../print.format';
import type { VertetimTemplateData } from '../print.dto';
import {
  renderSignatureColumn,
  renderStampArea,
  wrapDocument,
} from './shared-styles';

export function renderVertetim(data: VertetimTemplateData): string {
  return wrapDocument(renderBody(data), 'Vërtetim');
}

function renderBody(data: VertetimTemplateData): string {
  const { clinic, patient } = data;
  const diagnosisBox = renderDiagnosisBox(data);
  const dobLine = patient.dateOfBirth
    ? `e lindur më <strong>${escapeHtml(formatIsoDateDdMmYyyy(patient.dateOfBirth))}</strong>`
    : '';
  const placeLine = patient.placeOfBirth
    ? ` në <strong>${escapeHtml(patient.placeOfBirth)}</strong>`
    : '';
  return `
    <style>
      .paper { padding: 16mm 16mm 12mm; font-size: 10pt; line-height: 1.5; }
      .cert-lh {
        text-align: center;
        padding-bottom: 6mm;
        border-bottom: 2px solid #0F766E;
        margin-bottom: 10mm;
      }
      .cert-lh .mark {
        display: inline-block;
        margin-bottom: 3mm;
        color: #0F766E;
      }
      .cert-lh .cert-name {
        font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
        font-size: 13pt; font-weight: 700;
        letter-spacing: -0.005em; color: #0F766E;
      }
      .cert-lh .cert-meta {
        font-size: 8pt; color: #57534E;
        margin-top: 2mm; font-variant-numeric: tabular-nums;
      }
      .cert-title {
        text-align: center;
        font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
        font-size: 26pt; font-weight: 700; letter-spacing: 0.15em;
        color: #0F766E;
        margin: 8mm 0 12mm;
        position: relative;
      }
      .cert-title::before, .cert-title::after {
        content: ''; position: absolute; top: 50%;
        width: 25mm; height: 1px; background: #D6D3D1;
      }
      .cert-title::before { left: 8mm; }
      .cert-title::after { right: 8mm; }
      .cert-num {
        display: flex; justify-content: space-between;
        font-size: 8.5pt; color: #57534E;
        margin-bottom: 8mm;
      }
      .cert-num strong { color: #1c1917; font-weight: 600; font-variant-numeric: tabular-nums; }
      .cert-body { font-size: 11pt; line-height: 1.7; text-align: justify; color: #1c1917; }
      .cert-body strong { font-weight: 600; }
      .cert-dx-box {
        margin: 8mm auto;
        padding: 5mm 8mm;
        border: 1.5px solid #0F766E;
        border-radius: 3px;
        text-align: center;
        max-width: 100mm;
        background: rgba(204,251,241,0.18);
      }
      .cert-dx-box .lab {
        font-size: 7.5pt; color: #0F766E;
        text-transform: uppercase; letter-spacing: 0.1em;
        font-weight: 700; margin-bottom: 2mm;
      }
      .cert-dx-box .dx {
        font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
        font-size: 12pt; font-style: italic; font-weight: 600;
        color: #1c1917;
      }
      .cert-dx-box .code {
        font-family: 'JetBrains Mono', ui-monospace, monospace;
        font-size: 9pt; color: #0F766E; font-style: normal;
        font-weight: 700; margin-right: 5mm;
      }
      .cert-period {
        text-align: center; margin-top: 6mm; font-size: 10pt;
      }
      .cert-period strong { font-weight: 600; font-variant-numeric: tabular-nums; }
      .doc-footer { padding-top: 12mm; }
    </style>

    <article class="paper">
      <header class="cert-lh">
        <div class="mark">
          <svg width="26" height="26" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M32 54 C 12 40, 8 26, 18 18 C 24 14, 30 16, 32 22 C 34 16, 40 14, 46 18 C 56 26, 52 40, 32 54 Z" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M10 34 L 22 34 L 26 28 L 30 40 L 34 30 L 38 36 L 54 36" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
            <circle cx="54" cy="36" r="2.6" fill="currentColor"/>
          </svg>
        </div>
        <div class="cert-name">${escapeHtml(clinic.shortName)}</div>
        <div class="cert-meta">${escapeHtml(clinic.formalName)} · ${escapeHtml(clinic.city)}, Kosovë<br>
          Tel: ${clinic.phones.map((p) => escapeHtml(p)).join(' · ')} · ${escapeHtml(clinic.hoursLine)}
        </div>
      </header>

      <h1 class="cert-title">VËRTETIM</h1>

      <div class="cert-num">
        <span>Nr. <strong>${escapeHtml(data.certificateNumber)}</strong></span>
        <span>Data: <strong>${escapeHtml(formatIsoDateDdMmYyyy(data.issuedAtIso.slice(0, 10)))}</strong></span>
      </div>

      <div class="cert-body">
        Me të cilin vërtetohet se <strong>${escapeHtml(patient.fullName)}</strong>${dobLine ? ', ' + dobLine : ''}${placeLine}, ka munguar në shkollë / kopsht për arsye shëndetësore.

        ${diagnosisBox}

        <div class="cert-period">
          Ky vërtetim i lëshohet për të arsyetuar mungesat<br>
          për periudhën <strong>${escapeHtml(formatIsoDateDdMmYyyy(data.absenceFrom))} – ${escapeHtml(formatIsoDateDdMmYyyy(data.absenceTo))}</strong>
          (<strong>${data.durationDays}</strong> ${data.durationDays === 1 ? 'ditë' : 'ditë'}).
        </div>
      </div>

      <footer class="doc-footer">
        ${renderSignatureColumn(data.signature)}
        ${renderStampArea()}
      </footer>
    </article>
  `;
}

function renderDiagnosisBox(data: VertetimTemplateData): string {
  // Always use the snapshot — never the live diagnosis. If the
  // structured diagnosis happened to be available at issue time we
  // render the code + description; otherwise the snapshot string is
  // shown as-is (covers legacy migrated visits with text diagnoses).
  const dx = data.diagnosis;
  if (dx) {
    return `
      <div class="cert-dx-box">
        <div class="lab">Diagnoza</div>
        <div class="dx"><span class="code">${escapeHtml(dx.code)}</span>${escapeHtml(dx.latinDescription)}</div>
      </div>
    `;
  }
  if (hasText(data.diagnosisSnapshot)) {
    return `
      <div class="cert-dx-box">
        <div class="lab">Diagnoza</div>
        <div class="dx">${escapeHtml(data.diagnosisSnapshot)}</div>
      </div>
    `;
  }
  return '';
}
