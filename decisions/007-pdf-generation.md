# ADR 007: PDF generation (server-side Puppeteer, not archived)

Date: 2026-05-13
Status: Accepted

## Context

Klinika generates printed documents (visit reports, school certificates / vërtetime, patient history printouts). Requirements:
- A5 portrait page size
- Multi-page support (visit report can have a second page for ultrasound)
- Albanian text with proper diacritics (ë, ç)
- Reserved blank stamp area (~5×5cm) for physical clinic stamps — never digital
- Scanned doctor's signature image rendered at the signature line
- Tabular numerals for measurements (weight, height, head circumference)
- Print to actual paper, so output quality matters

Options considered:
- **Client-side react-to-print** — uses the browser's print stylesheet
- **Server-side Puppeteer** — render HTML on the server, output as PDF
- **wkhtmltopdf** — older alternative to Puppeteer
- **PDFKit / PDF-Lib** — programmatic PDF construction
- **LaTeX** — premium typography, complex toolchain

## Decision

**Server-side Puppeteer** for all PDF generation. The frontend embeds the PDF in a hidden iframe and triggers the browser's print dialog.

Templates are HTML files in `apps/api/src/modules/print/templates/` styled with print-specific Tailwind classes and CSS. Each template renders against typed input data (visit data, patient data, clinic data) and outputs A5 portrait PDF.

**PDFs are NOT archived.** Every print or preview regenerates the PDF fresh from the current data. To protect against drift:

1. **Field snapshots:** When a vërtetim is issued, the diagnosis text is snapshotted onto the vërtetim record. Reprints use the snapshot, not the live diagnosis.
2. **Versioned templates:** Print template files are kept in code with version numbers. The audit log records which template version was used.
3. **Audit log content snapshots:** When a print or vërtetim is issued, the audit log captures a content snapshot (the rendered key fields).

This means we never store PDF binaries, but reprints always produce the original document.

## Consequences

**Pros:**
- Output quality is excellent (Puppeteer / Chromium renders web typography correctly)
- Albanian diacritics, web fonts, and CSS layouts all work natively
- Templates are HTML — easy to edit, version-control, preview during dev
- No PDF storage costs (PDFs are ephemeral)
- Print previews are exactly what prints (single rendering pipeline)
- Server-side generation means consistent output regardless of doctor's browser

**Cons:**
- Puppeteer requires a Chromium binary (~150MB) in the production image
- Cold start: first PDF generation after server start is slower (~1-2s warmup)
- Concurrent PDF generation is memory-intensive (~80MB per render)
- Requires careful sandboxing for security (Puppeteer in a Docker container with no internet egress)

**Accepted trade-offs:**
- Larger Docker image size (acceptable for clinic-scale traffic)
- Puppeteer's startup cost mitigated by keeping a warm browser instance
- We accept the regeneration-on-print model — drift protection is robust enough

**On not archiving:**
- Saves ~5-15 GB per clinic per year in storage
- Eliminates "the archived PDF is out of sync with the data" class of bugs
- Reprints always work, even for visits from years ago, as long as the data is intact
- If a regulator ever requires PDF archival, we can add it later as an opt-in audit feature

## Revisit when

- A clinic asks for a "download all printed PDFs from year X" report (would require archival)
- PDF generation latency exceeds 5 seconds consistently
- Concurrent PDF demand exceeds server memory capacity
- A legal requirement mandates archived PDFs as immutable records

## Implementation notes

- Puppeteer runs as a long-lived singleton via `puppeteer-cluster` to avoid per-request startup cost
- Maximum concurrent renders: 4 (configurable)
- Print templates use embedded fonts (Inter + Inter Display via base64 data URLs)
- Stamp area rendered as a faintly bordered blank rectangle with `print-color-adjust: exact` to preserve in print
- The phrase "Vendi i vulës" appears in print preview only (via `@media screen`) — never on the actual printed page
- All PDFs A5 portrait: 148mm × 210mm with 15mm margins minimum
