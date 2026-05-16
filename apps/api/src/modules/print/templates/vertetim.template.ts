// Vërtetim (medical certificate) template — A5 portrait, single page.
//
// Translated from `design-reference/prototype/print-certificate.html`
// with the approved-design tweaks layered on top:
//   * Serial moved into a top-right tag in the letterhead (kicker
//     label "Nr. vërtetimi" above the VM-YYYY-NNNN number).
//   * Title "VËRTETIM" sits near the top, immediately under the
//     letterhead — never at the bottom.
//   * Body order: attestation prose (with patient name + DOB +
//     place bolded inline), diagnosis card (latinized text only,
//     no ICD code), centered period sentence.
//   * Attestation prose uses "në shkollë" only (the "/ kopsht"
//     pairing from v1 is retired — kindergartens use a different
//     receipt form).
//   * Footer: issue block left, signature right; no stamp slot.
//
// Fits a single A5 page. Earlier passes layered a "Subject
// identification block" + a structured period card with a policy
// note above the footer; both pushed content past the page break
// and were retired in favor of the inline attestation prose the
// design calls for.
//
// Field visibility (canonical):
//   master data — name + DOB + place rendered inline within prose
//   diagnosis   — frozen `diagnosisSnapshot` (with structured fallback)
//   period      — absence_from / absence_to + duration in days
//   excluded    — vitals, allergies, prescription, exams, follow-ups.

import {
  escapeHtml,
  formatIsoDateDdMmYyyy,
  hasText,
} from '../print.format';
import type { VertetimTemplateData } from '../print.dto';
import {
  renderIssueBlock,
  renderSignatureColumn,
  wrapDocument,
} from './shared-styles';

export function renderVertetim(data: VertetimTemplateData): string {
  return wrapDocument(renderBody(data), 'Vërtetim');
}

function renderBody(data: VertetimTemplateData): string {
  return `
    <style>${vertetimStyles()}</style>
    <article class="paper">
      ${renderLetterhead(data)}
      <h1 class="cert-title">VËRTETIM</h1>
      ${renderAttestationProse(data)}
      ${renderDiagnosisCard(data)}
      ${renderPeriodSentence(data)}
      <footer class="doc-footer">
        ${renderIssueBlock(data.signature)}
        ${renderSignatureColumn(data.signature)}
      </footer>
    </article>
  `;
}

function renderLetterhead(data: VertetimTemplateData): string {
  const { clinic } = data;
  const phonesLine = clinic.phones.map((p) => escapeHtml(p)).join(' · ');
  const licenseLine = clinic.licenseNumber
    ? `<br><span class="lic">${escapeHtml(clinic.licenseNumber)}</span>`
    : '';
  return `
    <header class="cert-letterhead">
      <div class="lh-info">
        <span class="formal">${escapeHtml(clinic.formalName)}</span>
        <div class="name">${escapeHtml(clinic.shortName)}</div>
        <div class="meta">
          ${escapeHtml(clinic.address)}, ${escapeHtml(clinic.city)}, Kosovë<br>
          Tel: ${phonesLine}<br>
          ${escapeHtml(clinic.hoursLine)}${licenseLine}
        </div>
      </div>
      <div class="cert-serial-tag">
        <span class="kicker">Nr. vërtetimi</span>
        <span class="num">${escapeHtml(data.certificateNumber)}</span>
      </div>
    </header>
  `;
}

function renderAttestationProse(data: VertetimTemplateData): string {
  const { patient, clinic } = data;
  const dobBold = patient.dateOfBirth
    ? `, e lindur më <strong>${escapeHtml(formatIsoDateDdMmYyyy(patient.dateOfBirth))}</strong>`
    : '';
  const placeBold = patient.placeOfBirth
    ? ` në <strong>${escapeHtml(patient.placeOfBirth)}</strong>`
    : '';
  // Note: "në shkollë" only — the legacy "/ kopsht" pairing is
  // retired per the approved design. Kindergarten absences use a
  // separate form.
  return `
    <div class="cert-prose">
      Me anë të këtij dokumenti vërtetohet se <strong>${escapeHtml(patient.fullName)}</strong>${dobBold}${placeBold}, ka munguar në shkollë për arsye shëndetësore, vërtetuar nga <strong>${escapeHtml(clinic.shortName)}</strong>.
    </div>
  `;
}

function renderDiagnosisCard(data: VertetimTemplateData): string {
  // Always render the latinized text only — the ICD code stays out
  // of the printed cert per the approved design. Snapshot wins when
  // a structured diagnosis isn't available (covers legacy migrated
  // visits with text diagnoses).
  const dxText = data.diagnosis
    ? data.diagnosis.latinDescription
    : hasText(data.diagnosisSnapshot)
      ? stripIcdCodeFromSnapshot(data.diagnosisSnapshot)
      : '';
  if (!dxText) return '';
  return `
    <div class="cert-dx-card">
      <div class="lab">Diagnoza</div>
      <div class="dx">${escapeHtml(dxText)}</div>
    </div>
  `;
}

function stripIcdCodeFromSnapshot(snapshot: string): string {
  // The snapshot text is formatted "J03.9 — Tonsillitis acuta" when
  // created from a structured diagnosis. Strip the leading code so
  // the cert shows the latinized name only.
  const m = snapshot.match(/^[A-Z]\d+(?:\.\d+)?\s*[—–-]\s*(.+)$/);
  return m && m[1] ? m[1].trim() : snapshot.trim();
}

function renderPeriodSentence(data: VertetimTemplateData): string {
  // Simple centered prose. Date range + day count bold inline. No
  // structured card, no policy footnote — those were retired
  // because they pushed the cert past one A5 page. CLAUDE.md §1.5:
  // Albanian only. "ditë" used for both singular and plural
  // (Albanian doesn't decline the noun here).
  const dateRange = `${formatIsoDateDdMmYyyy(data.absenceFrom)} – ${formatIsoDateDdMmYyyy(data.absenceTo)}`;
  return `
    <div class="cert-period">
      Ky vërtetim i lëshohet për të arsyetuar mungesat<br>
      për periudhën <strong>${escapeHtml(dateRange)}</strong> (<strong>${data.durationDays} ditë</strong>).
    </div>
  `;
}

function vertetimStyles(): string {
  return `
    .paper { padding: 14mm 14mm 12mm; font-size: 10pt; line-height: 1.5; }

    /* Letterhead — clinic identity left, serial tag top-right. */
    .cert-letterhead {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12mm;
      align-items: start;
      padding-bottom: 5mm;
      border-bottom: 1.5px solid #0F766E;
      margin-bottom: 6mm;
    }
    .cert-letterhead .lh-info { text-align: left; min-width: 0; }
    .cert-letterhead .formal {
      display: block;
      font-size: 7pt;
      font-weight: 500;
      letter-spacing: 0.04em;
      color: #57534E;
      text-transform: uppercase;
      margin-bottom: 1.5mm;
    }
    .cert-letterhead .name {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 14pt;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #0F766E;
      line-height: 1;
    }
    .cert-letterhead .meta {
      font-size: 7.5pt;
      color: #57534E;
      margin-top: 2.5mm;
      line-height: 1.55;
      font-variant-numeric: tabular-nums;
    }
    .cert-letterhead .meta .lic {
      color: #78716C;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 7pt;
      margin-top: 1mm;
      display: inline-block;
      letter-spacing: 0.02em;
    }
    .cert-serial-tag {
      text-align: right;
      line-height: 1;
      padding-left: 8mm;
      border-left: 1px solid #E7E5E4;
    }
    .cert-serial-tag .kicker {
      display: block;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 6.3pt;
      color: #A8A29E;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 500;
      margin-bottom: 2mm;
    }
    .cert-serial-tag .num {
      display: block;
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 12pt;
      font-weight: 700;
      color: #0F766E;
      letter-spacing: 0.04em;
      font-variant-numeric: tabular-nums;
    }

    .cert-title {
      text-align: center;
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 26pt;
      font-weight: 700;
      letter-spacing: 0.15em;
      color: #0F766E;
      margin: 4mm 0 8mm;
      position: relative;
    }
    .cert-title::before, .cert-title::after {
      content: '';
      position: absolute;
      top: 50%;
      width: 14mm;
      height: 1px;
      background: #D6D3D1;
    }
    .cert-title::before { left: 0; }
    .cert-title::after { right: 0; }

    .cert-prose {
      font-size: 11pt;
      line-height: 1.75;
      text-align: justify;
      text-justify: inter-word;
      color: #1c1917;
      margin-bottom: 6mm;
    }
    .cert-prose strong { font-weight: 600; }

    /* Diagnosis card — single line, latinized only, no ICD code. */
    .cert-dx-card {
      margin: 0 auto 6mm;
      padding: 4mm 8mm;
      border: 1px solid #0F766E;
      border-radius: 3px;
      text-align: center;
      max-width: 110mm;
      background: rgba(204, 251, 241, 0.18);
    }
    .cert-dx-card .lab {
      font-size: 7pt;
      color: #0F766E;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 700;
      margin-bottom: 1.5mm;
    }
    .cert-dx-card .dx {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 12pt;
      font-style: italic;
      font-weight: 600;
      color: #1c1917;
    }

    /* Period sentence — simple centered prose with date range and
       day count bolded inline. Replaces the older 2-col structured
       card that pushed the cert past one A5 page. */
    .cert-period {
      text-align: center;
      margin-top: 4mm;
      font-size: 10.5pt;
      line-height: 1.6;
      color: #1c1917;
    }
    .cert-period strong {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }

    .doc-footer { padding-top: 10mm; }
  `;
}

