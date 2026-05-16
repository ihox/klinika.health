// Vërtetim (medical certificate) template — A5 portrait, single page.
//
// Translated from `design-reference/prototype/print-certificate.html`
// with the approved-design tweaks layered on top:
//   * Serial moved into a top-right tag in the letterhead (kicker
//     label "Nr. vërtetimi" above the VM-YYYY-NNNN number).
//   * Title "VËRTETIM" sits near the top, immediately under the
//     letterhead — never at the bottom.
//   * Body order: subject identification block, attestation prose,
//     diagnosis card (latinized text only, no ICD code), period
//     card with big day count on the right.
//   * Attestation prose uses "në shkollë" only (the "/ kopsht"
//     pairing from v1 is retired — kindergartens use a different
//     receipt form).
//   * Footer: issue block left, signature right; no stamp slot.
//
// Field visibility (canonical):
//   master data — name + DOB + place + sex + age + clinic ID
//   diagnosis — frozen `diagnosisSnapshot` (with structured fallback)
//   period — absence_from / absence_to
//   excluded: vitals, allergies, prescription, exams, follow-ups.

import {
  ageLabelLong,
  escapeHtml,
  formatIsoDateDdMmYyyy,
  hasText,
  sexLabel,
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
      ${renderSubjectBlock(data)}
      ${renderAttestationProse(data)}
      ${renderDiagnosisCard(data)}
      ${renderPeriodCard(data)}
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

function renderSubjectBlock(data: VertetimTemplateData): string {
  const { patient } = data;
  const dobIso = patient.dateOfBirth;
  const ageStr = dobIso
    ? ageLabelLong(dobIso, data.issuedAtIso.slice(0, 10))
    : '';
  const sexStr = sexLabel(data.patientSex);
  const dobLine = dobIso
    ? escapeHtml(formatIsoDateDdMmYyyy(dobIso))
    : '—';
  const placeLine = patient.placeOfBirth
    ? escapeHtml(patient.placeOfBirth)
    : '—';
  const sexAgeParts: string[] = [];
  if (sexStr) sexAgeParts.push(sexStr.charAt(0).toUpperCase() + sexStr.slice(1));
  if (ageStr) sexAgeParts.push(ageStr);
  const sexAge = sexAgeParts.length > 0 ? sexAgeParts.join(' · ') : '—';
  return `
    <div class="subject-block">
      <div class="subject-name">${escapeHtml(patient.fullName)}</div>
      <div class="subject-grid">
        <div class="subject-cell">
          <div class="l">Datëlindja · Vendi</div>
          <div class="v">${dobLine} · ${placeLine}</div>
        </div>
        <div class="subject-cell">
          <div class="l">Gjinia · Mosha</div>
          <div class="v">${escapeHtml(sexAge)}</div>
        </div>
        <div class="subject-cell">
          <div class="l">ID në klinikë</div>
          <div class="v">${escapeHtml(data.patientIdLabel)}</div>
        </div>
      </div>
    </div>
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

function renderPeriodCard(data: VertetimTemplateData): string {
  const dateRange = `${formatIsoDateDdMmYyyy(data.absenceFrom)} – ${formatIsoDateDdMmYyyy(data.absenceTo)}`;
  // CLAUDE.md §1.5: Albanian only. "ditë" used for both 1-day and
  // multi-day periods (Albanian doesn't decline the noun here).
  return `
    <div class="cert-period-card">
      <div class="period-left">
        <div class="period-label">Periudha e arsyetuar</div>
        <div class="period-range">${escapeHtml(dateRange)}</div>
        <div class="period-note">
          Kthim në aktivitete normale i lejohet vetëm pas vlerësimit klinik.
        </div>
      </div>
      <div class="period-right">
        <div class="period-days">${data.durationDays}</div>
        <div class="period-unit">ditë</div>
      </div>
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

    /* Subject identification block — faded panel, teal left border. */
    .subject-block {
      background: #FAFAF9;
      border-left: 3px solid #0F766E;
      padding: 4mm 6mm 4mm 6mm;
      margin-bottom: 7mm;
      border-radius: 0 2px 2px 0;
    }
    .subject-name {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 12pt;
      font-weight: 700;
      color: #1c1917;
      margin-bottom: 3mm;
      letter-spacing: -0.005em;
    }
    .subject-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 3mm 6mm;
    }
    .subject-cell .l {
      font-size: 6.3pt;
      font-weight: 500;
      letter-spacing: 0.06em;
      color: #78716C;
      text-transform: uppercase;
      margin-bottom: 0.5mm;
    }
    .subject-cell .v {
      font-size: 9pt;
      color: #1c1917;
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }

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

    /* Period card — 2-col: label/dates left, big day count right. */
    .cert-period-card {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8mm;
      align-items: center;
      padding: 5mm 6mm;
      border: 1px solid #D6D3D1;
      border-radius: 3px;
      background: white;
    }
    .period-left .period-label {
      font-size: 7pt;
      color: #0F766E;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 1.5mm;
    }
    .period-left .period-range {
      font-family: 'JetBrains Mono', ui-monospace, monospace;
      font-size: 11pt;
      font-weight: 700;
      color: #1c1917;
      letter-spacing: 0.01em;
      font-variant-numeric: tabular-nums;
      margin-bottom: 2mm;
    }
    .period-left .period-note {
      font-size: 8pt;
      color: #57534E;
      line-height: 1.45;
      font-style: italic;
    }
    .period-right {
      text-align: center;
      padding-left: 6mm;
      border-left: 1px solid #E7E5E4;
      min-width: 24mm;
    }
    .period-right .period-days {
      font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
      font-size: 24pt;
      font-weight: 700;
      color: #0F766E;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .period-right .period-unit {
      font-size: 8pt;
      color: #57534E;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-top: 1.5mm;
      font-weight: 600;
    }

    .doc-footer { padding-top: 10mm; }
  `;
}

