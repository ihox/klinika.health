// Shared CSS for every print template.
//
// Every template is a single self-contained HTML document so Puppeteer
// can render it without external fetches. Network egress is blocked at
// the Docker layer (ADR-007); the CSS below has no external @import
// and no remote font URLs.
//
// Fonts: Inter / Inter Tight / JetBrains Mono are listed in
// font-family but fall back to `system-ui` / `monospace` when the
// containers don't have them installed. The print output uses tabular
// numerals via `font-variant-numeric: tabular-nums`.
//
// Template version: bumped when the visible output of any template
// changes (audit log records the version so reprints can be matched
// against the rendered-at-time template). v2 = approved design pass
// (unified letterhead, stamp slot removed, issue-block footer).
export const PRINT_TEMPLATE_VERSION = 2;

export const PRINT_SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1c1917;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    background: white;
  }
  .tabular { font-variant-numeric: tabular-nums; }
  .mono { font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace; }
  .display { font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif; }
  .teal { color: #0F766E; }
  .muted { color: #57534E; }
  .faint { color: #78716C; }

  @page {
    size: A5 portrait;
    margin: 0;
  }
  .paper {
    width: 148mm;
    min-height: 210mm;
    padding: 14mm 14mm 12mm;
    background: white;
    font-size: 9pt;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    position: relative;
    page-break-after: always;
  }
  .paper:last-child { page-break-after: auto; }

  /* Unified letterhead — visit + history share the same shape.
     Left column = clinic identity (formal subtitle + name + address
     + phones + hours + licence), right column = patient main info
     (name + ID + DOB + birth & today measurements). A teal 1.5px
     bottom rule separates header from body. */
  .lh {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    gap: 10mm;
    padding-bottom: 5mm;
    border-bottom: 1.5px solid #0F766E;
    margin-bottom: 3mm;
  }
  .lh-clinic { text-align: left; min-width: 0; }
  .lh-clinic .formal {
    display: block;
    font-size: 6.8pt;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: #57534E;
    text-transform: uppercase;
    margin-bottom: 1mm;
    line-height: 1.2;
  }
  .lh-clinic .name {
    font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
    font-size: 13pt;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #0F766E;
    line-height: 1;
  }
  .lh-clinic .meta {
    margin-top: 2mm;
    font-size: 7.3pt;
    color: #57534E;
    line-height: 1.55;
    font-variant-numeric: tabular-nums;
  }
  .lh-clinic .meta .lic {
    display: inline-block;
    margin-top: 0.8mm;
    color: #78716C;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 6.8pt;
    letter-spacing: 0.02em;
  }
  .lh-patient { text-align: right; align-self: flex-start; min-width: 0; }
  .lh-patient .pt-name {
    font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
    font-size: 14pt;
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1;
    color: #1c1917;
  }
  .lh-patient .pt-id {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 8pt;
    color: #78716C;
    font-weight: 600;
    letter-spacing: 0.04em;
    margin-top: 1mm;
  }
  .lh-patient .pt-id .id-sigil {
    color: #0F766E;
    font-weight: 700;
    margin-right: 0.5mm;
  }
  .lh-patient .pt-meta {
    font-size: 7.5pt;
    color: #57534E;
    margin-top: 1.5mm;
    line-height: 1.5;
    font-variant-numeric: tabular-nums;
  }
  .lh-patient .pt-meta .row {
    display: flex;
    justify-content: flex-end;
    gap: 3mm;
  }
  .lh-patient .pt-meta .k {
    color: #A8A29E;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 6.5pt;
    font-weight: 500;
    align-self: center;
  }
  .lh-patient .pt-meta .v { color: #1c1917; font-weight: 600; }
  .lh-patient .pt-meta .row.measures { margin-top: 0.6mm; }
  .lh-patient .pt-meta .row.measures .v {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 7.2pt;
    color: #1c1917;
    font-weight: 600;
    letter-spacing: -0.005em;
  }
  .lh-patient .pt-meta .row.measures .bm-l {
    font-family: 'Inter', sans-serif;
    font-size: 6.3pt;
    color: #78716C;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-right: 0.8mm;
  }
  .lh-patient .pt-meta .row.measures .bm-u {
    font-size: 6.3pt;
    color: #78716C;
    font-weight: 400;
    margin-left: 0.2mm;
  }

  /* Compact letterhead variant used on continuation pages
     (visit page 2, history page 2). Hides phones/hours/licence and
     shrinks the typographic scale. */
  .lh.compact {
    padding-bottom: 3mm;
    margin-bottom: 3mm;
  }
  .lh.compact .name { font-size: 10.5pt; }
  .lh.compact .formal { font-size: 6pt; }
  .lh.compact .meta { display: none; }
  .lh.compact .lh-patient .pt-name { font-size: 10.5pt; }
  .lh.compact .lh-patient .pt-meta { font-size: 6.8pt; }

  /* Reusable boxes (Dg / Th / An / Pl, UL, etc.) */
  .box {
    border: 1px solid #D6D3D1;
    border-radius: 3px;
    padding: 3.5mm 4.5mm;
  }
  .box .lab {
    font-size: 7.3pt;
    font-weight: 700;
    color: #0F766E;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 2.5mm;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  /* Footer pattern shared by visit, history, vërtetim:
       LEFT  — issue block (print stamp date+time, place)
       RIGHT — doctor signature column
     Kosovo law requires a physical ink stamp; the doctor places it
     by hand in the reserved bottom-right 5×5cm area next to the
     signature. No on-paper placeholder is rendered. */
  .doc-footer {
    margin-top: auto;
    padding-top: 8mm;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 10mm;
  }
  .issue-block {
    text-align: left;
    font-size: 8pt;
    color: #57534E;
    line-height: 1.5;
    font-variant-numeric: tabular-nums;
    align-self: flex-end;
  }
  .issue-block .issue-when {
    color: #1c1917;
    font-weight: 600;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 8.5pt;
    letter-spacing: 0.01em;
  }
  .issue-block .issue-when .dot {
    color: #C4C0BC;
    margin: 0 1mm;
    font-weight: 400;
  }
  .issue-block .issue-place {
    margin-top: 1mm;
    font-size: 8pt;
    color: #57534E;
    font-family: 'Inter', sans-serif;
    font-weight: 500;
  }

  .sig-col {
    font-size: 8.5pt;
    min-width: 60mm;
    text-align: right;
  }
  .sig-col .sig-img {
    height: 14mm;
    margin-bottom: 1mm;
    color: #1c1917;
    display: flex;
    justify-content: flex-end;
    align-items: flex-end;
  }
  .sig-col .sig-img img {
    max-height: 14mm;
    max-width: 60mm;
    display: block;
  }
  .sig-col .sig-line {
    border-top: 1px solid #1c1917;
    padding-top: 1.5mm;
    width: 60mm;
    margin-left: auto;
  }
  .sig-col .sig-name {
    font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
    font-weight: 700;
    font-size: 9pt;
  }
  .sig-col .sig-cred {
    color: #57534E;
    font-size: 7.5pt;
  }

  /* Multi-page numbering chip (history page 1 left-aligned kicker). */
  .page-num {
    font-size: 7pt;
    color: #78716C;
    font-variant-numeric: tabular-nums;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    letter-spacing: 0.05em;
    margin-top: 4mm;
    padding-top: 3mm;
  }
`;

/**
 * Blank-page wrapper: every template emits the same `<html>` shell
 * so the per-page CSS lives once. The body is concatenated by the
 * caller.
 */
export function wrapDocument(bodyHtml: string, titleSuffix: string): string {
  return `<!DOCTYPE html>
<html lang="sq">
<head>
<meta charset="UTF-8">
<title>Klinika — ${titleSuffix}</title>
<style>${PRINT_SHARED_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * SVG signature placeholder rendered when the doctor has no scanned
 * signature uploaded. A handwriting-like stroke that still leaves a
 * clear "signed here" indication — the doctor signs over it manually.
 */
export const SIGNATURE_PLACEHOLDER_SVG = `<svg viewBox="0 0 200 60" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="height: 14mm; width: auto; display: block;">
  <path d="M 8 42 Q 15 18 32 26 Q 42 32 36 42 Q 28 50 38 38 Q 50 24 64 36 Q 72 44 80 30 Q 90 14 100 28 Q 108 38 118 26 Q 130 12 144 30 Q 152 42 160 30 L 178 14" opacity="0.85"/>
  <path d="M 22 48 L 156 48" stroke-width="0.8" opacity="0.3"/>
</svg>`;

/**
 * Render the signature column. When a `signatureDataUri` is provided
 * (PNG/JPEG scanned image as base64) the image is embedded; otherwise
 * a faint placeholder svg + the standard "Dr. X" footer prints, which
 * the doctor can sign by hand. Right-aligned. The date+place pair
 * lives in the LEFT footer column (`renderIssueBlock`) instead — the
 * signature column carries only name + credential.
 */
export function renderSignatureColumn(signature: {
  fullName: string;
  credential: string;
  signatureDataUri: string | null;
}): string {
  const visual = signature.signatureDataUri
    ? `<img src="${signature.signatureDataUri}" alt="">`
    : SIGNATURE_PLACEHOLDER_SVG;
  return `
    <div class="sig-col">
      <div class="sig-img">${visual}</div>
      <div class="sig-line"></div>
      <div class="sig-name">${escapeForTemplate(signature.fullName)}</div>
      <div class="sig-cred">${escapeForTemplate(signature.credential)}</div>
    </div>
  `;
}

/**
 * Footer left column: the issue stamp generated at render time.
 *   line 1: "DD.MM.YYYY · HH:MM" (mono, dark)
 *   line 2: "Prizren" (Inter, muted)
 * Replaces the old `renderStampArea()` blank rectangle.
 */
export function renderIssueBlock(issue: {
  issuedAtDateTime: string;
  issuedPlace: string;
}): string {
  // The dot separator is a presentational span so it can be tinted
  // independently of the date/time numerals.
  const dt = escapeForTemplate(issue.issuedAtDateTime).replace(
    / · /,
    '<span class="dot">·</span>',
  );
  return `
    <div class="issue-block">
      <div class="issue-when">${dt}</div>
      <div class="issue-place">${escapeForTemplate(issue.issuedPlace)}</div>
    </div>
  `;
}

function escapeForTemplate(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
