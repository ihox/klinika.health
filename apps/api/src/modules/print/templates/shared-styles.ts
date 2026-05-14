// Shared CSS for every print template.
//
// Every template is a single self-contained HTML document so Puppeteer
// can render it without external fetches. Network egress is blocked at
// the Docker layer (ADR-007); the CSS below has no external @import
// and no remote font URLs.
//
// Fonts: Inter / Inter Display / JetBrains Mono are listed in
// font-family but fall back to `system-ui` / `monospace` when the
// containers don't have them installed. The print output uses tabular
// numerals via `font-variant-numeric: tabular-nums`.
//
// Template version: bumped when the visible output of any template
// changes (audit log records the version so reprints can be matched
// against the rendered-at-time template).
export const PRINT_TEMPLATE_VERSION = 1;

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
    padding: 15mm 15mm 12mm;
    background: white;
    font-size: 9pt;
    line-height: 1.4;
    display: flex;
    flex-direction: column;
    position: relative;
    page-break-after: always;
  }
  .paper:last-child { page-break-after: auto; }

  /* Letterhead */
  .lh {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 16px;
    padding-bottom: 6mm;
    border-bottom: 2px solid #0F766E;
    margin-bottom: 6mm;
  }
  .lh .lh-name {
    font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
    font-size: 14pt;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #0F766E;
    line-height: 1.05;
  }
  .lh .lh-formal {
    display: block;
    font-size: 7.5pt;
    font-weight: 500;
    letter-spacing: 0.02em;
    color: #57534E;
    text-transform: uppercase;
    margin-bottom: 2px;
  }
  .lh .lh-meta {
    margin-top: 5px;
    font-size: 7.5pt;
    color: #57534E;
    line-height: 1.5;
    font-variant-numeric: tabular-nums;
  }
  .lh-patient {
    text-align: right;
    font-size: 7.5pt;
    font-variant-numeric: tabular-nums;
  }
  .lh-patient table { border-collapse: collapse; margin-left: auto; }
  .lh-patient td { padding: 1px 0 1px 10px; text-align: right; }
  .lh-patient td.l { color: #78716C; font-weight: 500; padding-right: 4px; }
  .lh-patient td.v { color: #1c1917; font-weight: 600; }
  .lh-patient .pay-letter {
    font-family: 'Inter Tight', 'Inter Display', 'Inter', sans-serif;
    font-weight: 700;
    color: #0F766E;
  }

  /* Reusable boxes */
  .box {
    border: 1px solid #D6D3D1;
    border-radius: 3px;
    padding: 4mm 5mm;
  }
  .box .lab {
    font-size: 7.5pt;
    font-weight: 700;
    color: #0F766E;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: 2.5mm;
  }
  .box .lab .full {
    color: #78716C;
    font-weight: 500;
    margin-left: 4px;
  }

  /* Signature + stamp area */
  .doc-footer {
    margin-top: auto;
    padding-top: 8mm;
    display: grid;
    grid-template-columns: 1fr 50mm;
    gap: 10mm;
    align-items: flex-end;
  }
  .sig-col { font-size: 8.5pt; }
  .sig-col .sig-img {
    height: 16mm;
    margin-bottom: 2mm;
    color: #1c1917;
  }
  .sig-col .sig-img img { max-height: 16mm; max-width: 60mm; display: block; }
  .sig-col .sig-line {
    border-top: 1px solid #1c1917;
    padding-top: 1.5mm;
    width: 60mm;
  }
  .sig-col .sig-name { font-weight: 600; font-size: 9pt; }
  .sig-col .sig-cred { color: #57534E; font-size: 8pt; }
  .sig-col .sig-date {
    color: #57534E;
    font-size: 8pt;
    margin-top: 5mm;
    font-variant-numeric: tabular-nums;
  }

  /* Stamp area — NEVER renders any digital stamp. Always blank.
     The "Vendi i vulës" label is screen-only (preview) per CLAUDE.md §1.
     On actual paper output it must be invisible. */
  .stamp-area {
    height: 50mm;
    border: 1px dashed #D6D3D1;
    border-radius: 3px;
    display: grid;
    place-items: center;
    color: #A8A29E;
    font-size: 8pt;
    text-align: center;
    background: repeating-linear-gradient(
      45deg,
      transparent 0,
      transparent 8px,
      rgba(28,25,23,0.015) 8px,
      rgba(28,25,23,0.015) 9px
    );
  }
  .stamp-area .lab { text-transform: uppercase; letter-spacing: 0.1em; font-weight: 500; }
  .stamp-area .sub { font-size: 7pt; color: #C4C0BC; margin-top: 2mm; font-style: italic; }

  /* The print rules: the stamp area must be a clean blank rectangle
     when actually committed to paper. The preview label is for
     screen rendering only. */
  @media print {
    .stamp-area { border: none; background: none; }
    .stamp-area .lab, .stamp-area .sub { display: none; }
  }

  /* Page numbering — multi-page templates */
  .page-num {
    text-align: center;
    font-size: 7pt;
    color: #78716C;
    padding-top: 4mm;
    border-top: 1px solid #E7E5E4;
    margin-top: 4mm;
    font-variant-numeric: tabular-nums;
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
export const SIGNATURE_PLACEHOLDER_SVG = `<svg class="sig-img" viewBox="0 0 200 60" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
  <path d="M 8 42 Q 15 18 32 26 Q 42 32 36 42 Q 28 50 38 38 Q 50 24 64 36 Q 72 44 80 30 Q 90 14 100 28 Q 108 38 118 26 Q 130 12 144 30 Q 152 42 160 30 L 178 14" opacity="0.85"/>
  <path d="M 22 48 L 156 48" stroke-width="0.8" opacity="0.3"/>
</svg>`;

/**
 * Render the signature column. When a `signatureDataUri` is provided
 * (PNG/JPEG scanned image as base64) the image is embedded; otherwise
 * a faint placeholder svg + the standard "Dr. X" footer prints, which
 * the doctor can sign by hand. The stamp area always sits adjacent
 * and always blank.
 */
export function renderSignatureColumn(signature: {
  fullName: string;
  credential: string;
  signatureDataUri: string | null;
  dateAndPlace: string;
}): string {
  const visual = signature.signatureDataUri
    ? `<div class="sig-img"><img src="${signature.signatureDataUri}" alt=""></div>`
    : SIGNATURE_PLACEHOLDER_SVG;
  return `
    <div class="sig-col">
      ${visual}
      <div class="sig-line"></div>
      <div class="sig-name">${escapeForTemplate(signature.fullName)}</div>
      <div class="sig-cred">${escapeForTemplate(signature.credential)}</div>
      <div class="sig-date">${escapeForTemplate(signature.dateAndPlace)}</div>
    </div>
  `;
}

export function renderStampArea(): string {
  // The dashed border + diagonal pattern is preview-only via the
  // `@media print` rule above. On real paper, this prints as a blank
  // ~50mm-tall reserved area in the bottom-right corner.
  return `
    <div class="stamp-area">
      <div>
        <div class="lab">Vendi i vulës</div>
        <div class="sub">vendoset manualisht</div>
      </div>
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
