# Klinika Build Slice Plan

This document defines the sequence of Claude Code build sessions for Klinika v1. Each slice is a **vertical feature** — a complete, working piece touching all layers (DB, API, UI, tests, docs).

> **Updated:** After Claude Design delivered the `components/` subfolder. Slices 11-18 reference both top-level prototype files and the new components/ subfolder where appropriate.

## How to use this plan

For each slice:

1. Open a fresh Claude Code session
2. Paste the slice's full prompt from the "## Prompt" section (everything inside the code block)
3. Let Claude Code work end-to-end on that slice
4. Review, run tests, verify in browser
5. Commit on branch, open PR, merge to main
6. Move to next slice

Each slice fits in one focused 2-4 hour Claude Code session.

## The 18 slices

| #   | Slice                                                      | Status           |
| --- | ---------------------------------------------------------- | ---------------- |
| 1   | Project skeleton + Docker dev environment                  | ✅ Done          |
| 2   | Database schema + RLS + Prisma setup                       | ✅ Done          |
| 3   | Health checks + telemetry agent + logging                  | ✅ Done          |
| 4   | Better-Auth + email MFA + trusted devices                  | ✅ Done          |
| 5   | Platform admin /admin + tenant management                  | ✅ Done          |
| 6   | Clinic settings + working hours + payment codes            | ✅ Done          |
| 7   | Patient model + receptionist quick-add                     | ✅ Done          |
| 8   | Receptionist calendar + appointment CRUD                   | ✅ Done          |
| 9   | Appointment booking flow + conflict detection              | ✅ Done          |
| 10  | Doctor's home dashboard                                    | ✅ Done          |
| —   | **Design audit pass** (slices 1-10 vs new components/)     | Recommended next |
| 11  | Patient chart shell + visit list + master data strip       | Pending          |
| 12  | Visit form + auto-save + audit log per-field diffs         | Pending          |
| 13  | ICD-10 diagnosis picker + Terapia autocomplete             | Pending          |
| 14  | WHO growth charts (0-24mo)                                 | Pending          |
| 15  | Print pipeline + visit report + vërtetim + history         | Pending          |
| 16  | Orthanc + DICOM study picker + image viewer                | Pending          |
| 17  | Migration tool (Python, Access → Postgres)                 | Pending          |
| 18  | Production deploy + on-premise install + DonetaMED cutover | Pending          |

---

## Design reference structure (new)

`design-reference/prototype/` has two layers:

**Top-level files** — full screens in context (admin.html, chart.html, doctor.html, receptionist.html, clinic-settings.html, print-\*.html, etc.)

**`components/` subfolder** — 13 isolated component references:

| File                       | Used by slice                    |
| -------------------------- | -------------------------------- |
| `clinic-login.html`        | (slice 4, retrofitted via audit) |
| `password-reset.html`      | (slice 4, retrofitted via audit) |
| `mfa-verify.html`          | (slice 4, retrofitted via audit) |
| `edit-history-modal.html`  | **Slice 12**                     |
| `dicom-lightbox.html`      | **Slice 16**                     |
| `dicom-picker.html`        | **Slice 16**                     |
| `vertetim-dialog.html`     | **Slice 15**                     |
| `growth-chart-modal.html`  | **Slice 14**                     |
| `toast-undo.html`          | Slice 12 + design audit          |
| `save-failure-dialog.html` | **Slice 12**                     |
| `empty-states.html`        | All slices (universal)           |
| `loading-skeletons.html`   | All slices (universal)           |
| `connection-status.html`   | (slice 3, retrofitted via audit) |

When building a UI piece that has a `components/` reference, use it as the primary source of truth for that piece.

---

# DESIGN AUDIT PASS (recommended before SLICE 11)

The audit pass reviews implementations of slices 1-10 against the new component files. Run this in a fresh Claude Code session before SLICE 11. The prompt is in `docs/design-audit-prompt.md` (separately delivered).

Expected outcome: small targeted commits fixing design divergences in completed slices (MFA verify states, password reset flow, clinic login branding, empty states, loading skeletons, soft-delete toast on appointments).

---

# SLICE 11 — Patient chart shell + visit list + master data strip

**Goal:** The patient chart structure — master data strip on top, two-column layout below, visit list in left column, growth charts placeholder + ultrasound placeholder + vërtetim history in right column.

## Prompt

```
Read CLAUDE.md (especially Sections 1, 5, 10) and these design references:
- design-reference/prototype/chart.html (the full patient chart screen)
- design-reference/prototype/components/empty-states.html (for the empty state when no visits exist)
- design-reference/prototype/components/loading-skeletons.html (for the loading state of the chart)

Build the patient chart shell:

1. Routes:
   - GET /pacient/:id — patient chart (doctor only, 403 for receptionist)

2. Master data strip (full width, top, sticky on scroll):
   - ID · Name · Sex · Age (formatted "2v 3m" from DOB) · Vendi · Phone
   - Lindja sub-row: birth date · birth weight · length · head circumference
   - Color indicator chip (green >30 days / yellow 7-30 / red 1-7 since last visit)
   - ⚠ Alergji / Tjera with full text on hover (doctor-only, NEVER for receptionist)
   - Tabular numerals throughout

3. Below master data: two-column layout (~60% / 40% on desktop)

4. Left column: visit form area (filled in slice 12; placeholder for now):
   - Visit number indicator: "Vizita 4 nga 12"
   - Visit navigation: ◀ Paraprake / Ardhshme ▶ buttons
   - Visit date dropdown for direct jump
   - Action bar sticky at bottom (Fshij/Vizitë e re/Printo/Vërtetim/Histori — wired up in later slices)

5. Right column: clinical context panels (stubs for now):
   - "Diagramet e rritjes" — placeholder card, filled in slice 14
   - "Ultrazeri" — placeholder card, filled in slice 16
   - "Historia" — compact visit history list (read-only, jump-to)
   - "Vërtetime" — list of issued vërtetime with view + reprint actions (display only)

6. Visit history compact list:
   - Show 10 most recent visits
   - Per row: date · diagnosis short · payment code chip
   - Click → load that visit into left column
   - "Shfaq më shumë" expands to show all

7. Vërtetime list:
   - Per row: issue date · absence range · duration · diagnosis snapshot
   - Two icon actions: 👁 view + 🖨 reprint (wired up in slice 15)
   - Empty state from components/empty-states.html: "Asnjë vërtetim i lëshuar për këtë pacient"

8. URL structure:
   - /pacient/:id — defaults to most recent visit
   - /pacient/:id/vizita/:visit_id — specific visit
   - History dropdown updates URL on navigation

9. Visit navigation:
   - ◀ / ▶ buttons disabled at boundaries
   - Keyboard shortcuts: ← / → arrow keys (only when not focused in form field)
   - "Vizita X nga Y" indicator

10. Loading and empty states:
    - Loading: skeleton from components/loading-skeletons.html (master data strip skeleton + visit area skeleton)
    - No visits yet: "Asnjë vizitë e regjistruar. Shtoni të parën." with [Vizitë e re] button (per components/empty-states.html)

Constraints:
- Master data strip sticky on scroll
- Action bar sticky at bottom of left column
- Receptionist accessing /pacient/:id gets 403 (use existing empty-states pattern)
- All UI in Albanian

Tests:
- Unit: age formatting (2v 3m, 11m, 1v, edge cases)
- Unit: color indicator on master data strip
- Integration: GET /api/patients/:id returns full patient with related visits and vërtetime
- Integration: receptionist GET /pacient/:id returns 403
- E2E: open patient chart, navigate visits with ← →, see history list, click old visit, see master data update

Documentation:
- Document the patient chart data flow in docs/architecture.md

Commit on branch `slice-11-chart-shell`.
```

---

# SLICE 12 — Visit form + auto-save + audit log per-field diffs

**Goal:** The doctor's primary work surface — visit form with all clinical fields, auto-save with safety net, audit log writes with per-field diffs (JSONB array), edit history modal.

## Prompt

```
Read CLAUDE.md (especially Sections 5.3, 5.4, 5.5) and docs/decisions/008-soft-delete-undo.md and these design references:
- design-reference/prototype/chart.html (the full chart with visit form)
- design-reference/prototype/components/edit-history-modal.html (CRITICAL — the "Historia e ndryshimeve" modal)
- design-reference/prototype/components/toast-undo.html (the soft-delete + 30s undo toast)
- design-reference/prototype/components/save-failure-dialog.html (the auto-save failure dialog)
- design-reference/prototype/Update - MFA + Profili + Audit.html (for the "Modifikuar nga..." inline indicator pattern)

Build the visit form:

1. Visit form fields (in clinical order per the prototype):
   - Data e vizitës (auto-set, with "Nga vizita paraprake: N ditë" diff display)
   - Ankesa (textarea)
   - Ushqimi: 3 checkboxes — Gji / Formulë / Solid + free-text note field
   - Pesha (kg, decimal, tabular numerals)
   - Gjatësia (cm, decimal)
   - Perimetri i kokës (cm, decimal)
   - Temperatura (°C, decimal)
   - Pagesa: dropdown showing letter codes E/A/B/C/D
   - Ekzaminime (textarea)
   - Ultrazeri (textarea + image panel placeholder — filled in slice 16)
   - Diagnoza (multi-select, placeholder for slice 13)
   - Terapia (textarea with autocomplete — placeholder for slice 13)
   - Analizat (textarea)
   - Kontrolla (date or free text — clinic-configurable)

2. Auto-save (the safety net):
   - Triggers: 1.5s debounce, field blur, navigation, button save, 30s idle, beforeunload
   - State indicator visible at all times: Idle / Dirty / Saving / Saved / Error
   - State machine in React state + Zustand store
   - PATCH /api/visits/:id with only changed fields (delta save)
   - On failure: show dialog from components/save-failure-dialog.html — listing unsaved fields, retry option, "save to local" backup
   - Local IndexedDB backup of dirty state (cleared on successful save)
   - Page title gets * prefix when dirty

3. Save state indicator UI (in visit header):
   - Idle: empty
   - Dirty: "● Ndryshime të paruajtura" gentle warning color
   - Saving: spinner + "Duke ruajtur..."
   - Saved: ✓ "U ruajt 2 sek më parë" (updates every 10s)
   - Error: ⚠ "Ruajtja dështoi. Provoni përsëri." + retry button

4. Audit log writes (CLAUDE.md Section 5.3 + ADR 008):
   - On every save event, compute diff between pre-save and post-save state
   - Write one audit row per save event with `changes` JSONB array
   - Coalescing rule: same user + same visit within 60s = UPDATE existing row, don't insert new
   - Coalesce logic: SELECT FOR UPDATE the most recent audit row matching (resource_type, resource_id, user_id) within last 60s, merge changes, update timestamp

5. "Modifikuar nga..." inline indicator:
   - Only shown if visit has been updated AFTER initial creation
   - Format: "Modifikuar nga Dr. Taulant më 14.05.2026 13:47"
   - Subtle styling — small, muted color
   - Clickable: opens the change history modal

6. Change history modal (from components/edit-history-modal.html):
   - Title: "Historia e ndryshimeve · Vizita e [date]"
   - List of audit events, newest first
   - Each event: "Dr. Taulant · 14.05.2026 13:47" header, then field-by-field diffs using "më parë" / "tani" labels
   - First event: "Krijuar (vizita e re)" with no diffs
   - Long values truncate with "Shfaq plotësisht" expansion
   - Close: X button or Esc
   - Read-only (no restore/rollback in v1)

7. Delete visit (using components/toast-undo.html pattern):
   - Action bar [Fshij vizitën] button
   - No confirmation modal (Gmail pattern)
   - Soft delete: sets visit.deleted_at = now()
   - Toast (matching components/toast-undo.html): "Vizita u fshi. [Anulo]" with 30s countdown bar
   - Click "Anulo" within 30s: restore (deleted_at = null)
   - After 30s: toast dismisses, visit stays soft-deleted

8. Vizitë e re (new visit) button:
   - Creates new visit record for current patient
   - Pre-fills today's date
   - Other fields empty
   - Auto-save kicks in as soon as something typed

Constraints:
- Auto-save MUST never lose work
- Audit log writes transactional with visit update (same DB transaction)
- Coalescing prevents audit log spam from auto-save
- Form validation prevents save with critical errors (e.g. negative weight) but allows save with empty fields
- Tabular numerals for all numeric inputs

Tests:
- Unit: auto-save state machine transitions
- Unit: diff computation for changes JSONB
- Unit: audit coalescing within 60s window
- Integration: save → audit log row → another save 30s later → row updated, not duplicated
- Integration: save fails → local backup written → retry succeeds → backup cleared
- E2E: visit creation, auto-save while typing, save indicator updates, change history modal shows correct diffs
- E2E: delete visit + undo within 30s
- E2E: navigate away with unsaved changes triggers save

Documentation:
- Document the audit log coalescing rule prominently in docs/architecture.md

Commit on branch `slice-12-visit-form`.
```

---

# SLICE 13 — ICD-10 diagnosis picker + Terapia autocomplete

**Goal:** Multi-select ICD-10 with frequently-used codes float, personal prescription history autocomplete, snippet picker.

## Prompt

```
Read CLAUDE.md and design-reference/prototype/chart.html (focus on Diagnoza and Terapia sections).

Build the diagnosis picker and prescription autocomplete:

1. Diagnoza multi-select (ICD-10, Latin only):
   - Component: searchable multi-select combobox
   - Backend: GET /api/icd10/search?q=<query>&doctorId=<id>&limit=20
   - Returns codes ordered:
     - First: doctor's frequently-used codes that match (top 5)
     - Then: alphabetical match by code or description
   - Display per result: "J03.9   Tonsillitis acuta" (code monospace, description Inter)
   - No Albanian translations in v1 — Latin only
   - No suggestions banner — pure search
   - Selected diagnoses appear as chips above search field
   - Each chip has × to remove
   - Order matters: first chip = primary diagnosis
   - Drag-to-reorder via dnd-kit
   - Keyboard: arrows to navigate, Enter to add, Tab to commit, Backspace removes last chip

2. Frequently-used tracking:
   - Each time a visit is saved with diagnoses, increment use counts in `doctor_diagnosis_usage` table (doctor_id, icd10_code, use_count, last_used_at)
   - Per-doctor (not per-clinic)

3. Terapia autocomplete:
   - Multi-line textarea, monospace-ish font for medical shorthand
   - As doctor types each line (2+ chars), floating suggestions appear below cursor
   - Backend: GET /api/prescriptions/suggest?q=<line>&doctorId=<id>
   - Suggestions sourced from `prescription_lines` table (per-doctor index)
   - Display: prescription text + use count chip ("12 uses")
   - Keyboard: ↓ to navigate, Tab or Enter to accept, Esc dismisses
   - Right-click suggestion → "Harro këtë sugjerim" (deletes the row)
   - On visit save, parse Terapia line-by-line, upsert each line (increment use_count if exists, create if new)

4. Snippet picker (⌘/Ctrl + ;):
   - Opens modal with doctor's top 20 prescription patterns
   - Tap to insert at cursor
   - Each snippet: text + last used + use count

5. Prescription seeding from migration:
   - When Access migration runs (slice 17), pre-populate prescription_lines from historical Terapia values
   - Each unique line becomes a row, use_count = historical occurrences
   - Day-one of using Klinika, autocomplete already knows the doctor's patterns

Constraints:
- Diagnosis dropdown: max 20 results visible, virtualized if longer
- Diagnosis search handles ICD-10 chapters (J = respiratory, etc.)
- Prescription suggestions: max 6 visible, sorted by frequency-recency blend
- "Forget suggestion" requires inline confirmation (not modal)
- All visible text in Albanian where applicable

Tests:
- Unit: diagnosis search with frequently-used boost
- Unit: prescription line parsing and indexing
- Unit: snippet picker filtering
- Integration: save visit → diagnoses indexed → next visit picker shows recently-used at top
- Integration: prescription line auto-indexed on save
- E2E: doctor types a diagnosis, picks from dropdown, reorders, saves
- E2E: doctor types a prescription line, suggestion appears, accepts with Tab
- E2E: snippet picker opens with shortcut

Documentation:
- Document the per-doctor diagnosis/prescription history in docs/architecture.md

Commit on branch `slice-13-clinical-inputs`.
```

---

# SLICE 14 — WHO growth charts (0-24 months)

**Goal:** Compact sparkline charts in right column + full-size modal with three tabs (weight/length/head circumference), WHO percentile bands, age cutoff at 24 months with historical view.

## Prompt

```
Read CLAUDE.md and these design references:
- design-reference/prototype/chart.html (Diagramet e rritjes section in right column for compact sparklines)
- design-reference/prototype/components/growth-chart-modal.html (CRITICAL — the full-size modal with three tabs, percentile bands, sample data points, tooltip format)
- design-reference/prototype/components/empty-states.html (for "Asnjë e dhënë e regjistruar" state)

Build the WHO growth charts:

1. Data source:
   - Pre-load WHO Child Growth Standards data as static JSON fixtures in apps/web/lib/who-growth-data/
   - Three datasets: weight-for-age, length/height-for-age, head-circumference-for-age
   - Split by sex (boys / girls)
   - Age in months (0-24)
   - Percentile curves: P3, P15, P50, P85, P97
   - Source: WHO Child Growth Standards (publicly available CSVs)

2. Compact sparkline cards (in patient chart right column, per chart.html):
   - Three cards: "Pesha sipas moshës" / "Gjatësia sipas moshës" / "Perimetri i kokës"
   - Each shows: WHO percentile bands as soft gradient zones, patient's data points as dots connected by line, X-axis (months 0-24), Y-axis (values with units), tabular numerals
   - Click any sparkline → opens full-size modal

3. Full-size modal (from components/growth-chart-modal.html):
   - Three tabs: Pesha / Gjatësia / Perimetri kokës
   - Larger chart, more detail
   - Tooltip on hover: "Data: DD.MM.YYYY · Vlera: X · Mosha: N muaj"
   - Print this chart button (separate from main visit report)
   - Match visual treatment of components reference exactly (percentile bands, dot colors, line styling, tooltip)

4. Age cutoff at 24 months:
   - Patients ≤24 months: charts visible in right column
   - Patients >24 months: charts hidden (panel collapses)
   - Replacement: "Shiko grafikët historikë" link IF patient has historical 0-24mo data
   - Click → same modal with "Historiku 0-24 muaj" title

5. Sex requirement:
   - Growth charts require knowing patient's sex (boys vs girls have different curves)
   - For patients without explicit sex, infer from first name where possible (Albanian first names usually gendered)
   - For ambiguous/unknown, prompt doctor to set sex on patient record before showing charts
   - Sex is part of patient master data (verify schema from slice 7 includes `sex` enum)

6. Data point display:
   - Use only weight/height/head circumference data from saved visits (not pending edits)
   - If visit has measurements but no date, fall back to created_at
   - Convert ages from DOB to "age at visit in months"

7. Edge cases:
   - Patient has 0 measurements: empty state from components/empty-states.html with helper text "Asnjë e dhënë e regjistruar"
   - Patient has 1 measurement: single dot, no line
   - Patient has measurements at unusual ages: show only 0-24mo points on standard chart, link to historical view for older

Constraints:
- WHO data is publicly available — embed as static JSON
- Charts use design tokens (teal for patient's line, neutral grays for percentile bands)
- All UI in Albanian
- Receptionist never sees these (doctor-only)
- Match the visual style of components/growth-chart-modal.html exactly

Tests:
- Unit: age-in-months calculation from DOB and visit_date
- Unit: percentile band rendering
- Unit: data point filtering by age range
- Integration: chart loads for patient with measurements at various ages
- E2E: open chart, see growth chart cards, click to expand, see full-size modal with all three tabs

Documentation:
- Document the WHO data source in docs/architecture.md
- Note WHO data is public domain

Commit on branch `slice-14-growth-charts`.
```

---

# SLICE 15 — Print pipeline + visit report + vërtetim + history

**Goal:** All three printed document types — visit report (A5, page 1 + optional page 2 for ultrasound), vërtetim with in-app issue dialog + print template, patient history.

## Prompt

```
Read CLAUDE.md and docs/decisions/007-pdf-generation.md and these design references:
- design-reference/prototype/print-visit.html (the printed visit report template)
- design-reference/prototype/print-certificate.html (the printed vërtetim template)
- design-reference/prototype/print-history.html (the printed patient history template)
- design-reference/prototype/components/vertetim-dialog.html (CRITICAL — the in-app "Lësho vërtetim absencë" dialog)

Build the complete print pipeline:

1. Server-side Puppeteer setup:
   - Long-lived browser instance via puppeteer-cluster (max 4 concurrent renders)
   - Sandbox mode, no internet egress (Docker config)
   - Headless, A5 portrait page, margins 15mm minimum
   - Print templates as HTML/CSS in apps/api/src/modules/print/templates/

2. Print templates (translate from design-reference/prototype/print-*.html):
   - visit-report.html — A5, header (clinic letterhead + patient block including payment code with ID like "A · 15626"), body (Dg + Th), footer (signature + blank stamp area + date/place)
   - visit-report-page2.html — only rendered if ultrasound studies linked; clinic header (compact), Ultrazeri notes, up to 4 images in 2×2 grid, signature + stamp area
   - vertetim.html — A5, OSP DONETA-MED header, "VËRTETIM" title, body with name + DOB + place + diagnosis box + date range, signature + stamp area
   - history.html — multi-page, columns: Data · Pesha · Diagnoza · Terapia, sorted newest first, optional ultrasound appendix

3. API endpoints:
   - GET /api/print/visit/:id — generates visit report PDF
   - GET /api/print/vertetim/:id — generates vërtetim PDF
   - GET /api/print/history/:patient_id?include_ultrasound=true|false — generates history PDF
   - All return application/pdf with Cache-Control: no-store
   - Authentication enforced; doctor role required

4. Frontend print flow:
   - Click [Printo raportin] in chart action bar
   - For visit report: just confirm
   - For history: dialog toggles "Imazhet e ultrazerit (X imazhe)"
   - On confirm: fetch PDF, embed in hidden iframe, trigger browser print dialog
   - Iframe technique: `<iframe src="/api/print/visit/:id" hidden>` + iframe.contentWindow.print()

5. Vërtetim flow (using components/vertetim-dialog.html EXACTLY):
   - Click [Vërtetim] in chart action bar
   - Dialog opens matching components/vertetim-dialog.html:
     - Title: "Lësho vërtetim absencë"
     - Patient header (name + age, read-only)
     - Date range pickers (Nga + Deri) + quick-select chips (Sot, 3 ditë, 5 ditë, 1 javë, 10 ditë)
     - Live preview card showing periudha + kohëzgjatja
     - Diagnosis snapshot preview (read-only, from current visit's primary diagnosis)
     - Buttons: [Anulo] [Shiko vërtetimin] [Printo vërtetimin]
   - Validation: Deri >= Nga
   - On issue: insert vertetim row with diagnosis_snapshot frozen at issue time

6. Vërtetim history (in patient chart, from slice 11):
   - Each entry: 👁 view (opens print preview with stored data) + 🖨 reprint (direct print)
   - View renders the EXACT same vërtetim originally issued (using diagnosis_snapshot)
   - No void flow, no duplicate warnings

7. Print visibility table (CANONICAL — enforce in templates):
   | Field | Visit Report | Vërtetim | History |
   |---|:-:|:-:|:-:|
   | Master data | ✓ | ✓ subset | ✓ |
   | Alergji / Tjera | ✗ | ✗ | ✗ |
   | Payment code | ✓ (with ID) | ✗ | ✗ |
   | Date | ✓ | ✓ (issue) | ✓ |
   | Vitals | ✓ (box) | ✗ | ✓ (Pesha col) |
   | Diagnoza | ✓ | ✓ | ✓ |
   | Terapia | ✓ | ✗ | ✓ |
   | Analizat | ✓ | ✗ | ✓ |
   | Ankesa, Ushqimi, Ekzaminime | ✗ | ✗ | ✗ |
   | Ultrazeri | ✓ page 2 | ✗ | optional appendix |
   | Kontrolla, Tjera | ✗ | ✗ | ✗ |

8. Stamp area (NON-NEGOTIABLE):
   - Reserved blank rectangle ~5×5cm, bottom-right of every printed page
   - Faint "Vendi i vulës" text label appears in PREVIEW only (CSS @media screen)
   - Does NOT print on actual paper (CSS @media print hides the label)
   - The rectangle is always blank — NEVER any digital stamp rendering

9. Signature:
   - Doctor's scanned signature image (PNG) rendered at signature line if uploaded
   - Otherwise blank line above "Dr. Taulant Shala — pediatër"
   - Always paired with blank stamp area side-by-side

10. Audit log on print:
    - Action: print.visit_report.requested / print.vertetim.issued / print.history.requested
    - Records who, when, content snapshot

Constraints:
- Use Inter + Inter Display fonts (embedded as base64 in templates, no CDN fetches)
- Tabular numerals for all numeric values
- Page numbering "Faqe X/Y" on multi-page history
- Page breaks where natural
- NO digital stamps — hard rule enforced at template level

Tests:
- Unit: vertetim date range calculation
- Unit: print template field visibility matches canonical table
- Integration: generate PDF for visit, vertetim, history → valid PDF, expected size
- Integration: vertetim with diagnosis_snapshot returns frozen text even if visit diagnosis later changes
- E2E: print visit report from chart → PDF opens in print dialog
- E2E: issue vërtetim using the dialog → reprint identical document weeks later

Documentation:
- Update docs/architecture.md with the print pipeline diagram

Commit on branch `slice-15-print`.
```

---

# SLICE 16 — Orthanc + DICOM study picker + image viewer

**Goal:** Manual DICOM study picker (v1, MWL in v2). Doctor scans, pushes to Orthanc, opens visit, links a study. Linked images viewable in chart's Ultrazeri panel.

## Prompt

```
Read CLAUDE.md and docs/decisions/009-dicom-storage.md and these design references:
- design-reference/prototype/chart.html (Ultrazeri panel layout in right column)
- design-reference/prototype/components/dicom-picker.html (CRITICAL — the "Lidh studim ultrazeri" picker modal)
- design-reference/prototype/components/dicom-lightbox.html (CRITICAL — the full-screen DICOM image viewer)

Build the DICOM integration:

1. Orthanc Docker setup in infra/compose/:
   - Community Orthanc image
   - Storage volume mounted to /mnt/dicom-storage (on 2TB HDD in production)
   - Configured for TLS (modality-side TLS)
   - Authentication enabled, credentials in .env (ORTHANC_USERNAME, ORTHANC_PASSWORD)
   - REST API behind authentication

2. Klinika ↔ Orthanc bridge module (apps/api/src/modules/dicom/):
   - Klinika authenticates to Orthanc as admin user
   - On Orthanc receive (DICOM C-STORE), trigger webhook to Klinika
   - Klinika stores metadata in `dicom_studies` table: orthanc_study_id, received_at, image_count, study_description, patient_name (DICOM name, for fuzzy match suggestions)

3. API endpoints:
   - GET /api/dicom/recent — last 10 studies received from Orthanc (manual picker source)
   - GET /api/dicom/studies/:study_id — study details + image list
   - GET /api/dicom/instances/:instance_id/preview.png — rendered preview (cached)
   - GET /api/dicom/instances/:instance_id/full.dcm — full DICOM file (rare, audited)
   - POST /api/visits/:visit_id/dicom-links — link a study to a visit
   - DELETE /api/visits/:visit_id/dicom-links/:link_id — unlink

4. Manual study picker UI (from components/dicom-picker.html EXACTLY):
   - "Lidh studim të ri" button in patient chart Ultrazeri panel opens modal
   - Modal matches components/dicom-picker.html:
     - Title: "Lidh studim ultrazeri"
     - List of last 10 received DICOM studies
     - Each card: timestamp (when received) + thumbnail strip (up to 4 mini-thumbs) + image count "8 imazhe"
     - Click selects, [Lidh me këtë vizitë] button below
     - [Anulo] secondary
   - On link: dicom_study_id linked to current visit via visit_dicom_links

5. Linked studies display (in chart's Ultrazeri panel, per chart.html):
   - Thumbnails of linked studies
   - Click thumbnail → opens lightbox from components/dicom-lightbox.html

6. DICOM lightbox (from components/dicom-lightbox.html EXACTLY):
   - Full-screen overlay
   - Centered image with arrow navigation ◀ ▶ for multi-image studies
   - Zoom toggle (1x/2x)
   - Image counter ("3 / 8")
   - Close button (X, also Esc)
   - Patient name + visit date in top corner (small, muted)

7. Image proxy:
   - Klinika serves DICOM images via authenticated proxy
   - Never expose Orthanc REST API directly to browser
   - Browser fetches /api/dicom/instances/:id/preview.png with session auth
   - Server fetches from Orthanc internally
   - Image headers: Cache-Control: private, no-store

8. Audit log on DICOM access:
   - Action: dicom.study.viewed (picker opened)
   - Action: dicom.study.linked (linked to visit)
   - Action: dicom.instance.viewed (lightbox opens specific image)

9. Storage monitoring:
   - Telemetry agent reports Orthanc disk usage hourly
   - Alerts at 80% and 95% per ADR-009

Constraints:
- DICOM images never leave clinic LAN in raw form
- Browser only sees rendered PNG/JPEG previews
- Klinika authenticates to Orthanc with shared secret (rotated quarterly per runbook)
- Manual picker only in v1; MWL deferred to v2

Tests:
- Unit: DICOM study metadata parsing
- Unit: image preview generation (mock Orthanc response)
- Integration: link study to visit, unlink
- Integration: receptionist GET /api/dicom returns 403
- E2E: open manual picker, see studies, link one, see thumbnails in chart, open lightbox, navigate images

Documentation:
- Add docs/architecture.md section on the DICOM bridge
- Add docs/deployment.md section on Orthanc setup for on-premise

Commit on branch `slice-16-dicom`.
```

---

# SLICE 17 — Migration tool (Python, Access → Postgres)

**Goal:** Python migration tool. Idempotent via legacy_id. Produces reconciliation report. Imports 11k patients + 220k visits from MS Access.

## Prompt

````
Read CLAUDE.md and docs/decisions/010-migration-approach.md. The Access database will be at a path you'll be given (typically ~/PEDIATRIA.accdb, NEVER in Git).

Build the Python migration tool in tools/migrate/:

1. Tool structure:
   - tools/migrate/migrate.py — entrypoint
   - tools/migrate/config.yaml — mapping rules + target connection
   - tools/migrate/lib/ — extractors, transformers, loaders
   - tools/migrate/fixtures/ — sample extracted CSVs for testing
   - tools/migrate/requirements.txt — pandas, psycopg, pyyaml

2. CLI:
   - python migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --dry-run
   - python migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --execute
   - --target-clinic <clinic_id> — specify which clinic to load into

3. Workflow:
   a. Extract: use mdb-export to dump each Access table to CSV
   b. Profile: count rows, flag anomalies, write profile-report.json
   c. Transform: apply mapping rules from config.yaml
   d. Load: upsert into Postgres via psycopg with ON CONFLICT(clinic_id, legacy_id)
   e. Reconcile: count source vs target rows, write migration-report.json

4. config.yaml structure:
   ```yaml
   source:
     access_file: /path/to/PEDIATRIA.accdb
   target:
     dsn: postgresql://user:pass@host:5432/klinika
     clinic_id: <uuid>
   mappings:
     patients:
       source_table: Pacientet
       legacy_id_column: ID
       name_column: "Emri dhe mbiemri"
       split_strategy: last_word_is_last_name
       strip_asterisks: true
       date_column: Datelindja
       date_format: "DD.MM.YYYY"
       fields:
         place_of_birth: "Vendi"
         birth_weight_g:
           source: "PL"
           null_if_zero: true
         alergji_tjera: "Alergji"
         phone: "Telefoni"
       drop_fields: [SN, x]
     visits:
       source_table: Vizitat
       legacy_id_column: ID
       patient_link_column: "ALERT"
       patient_link_strategy: fuzzy_strip_asterisks
       date_column: Datar
       date_format: "MM/DD/YY"
       fields:
         complaint: Ankesa
         feeding_notes: Ushqimi
         feeding_breast_keywords: ["Gji"]
         feeding_formula_keywords: ["Formul"]
         feeding_solid_keywords: ["Solid"]
         weight_g: PT
         height_cm: GjT
         head_circumference_cm: Pk
         temperature_c: Temp
         payment_code: x
         examinations: Ekzaminime
         ultrasound_notes: Ultrazeri
         legacy_diagnosis: Diagnoza
         prescription: Terapia
         lab_results: Analizat
         followup_notes: Kontrolla
         other_notes: Tjera
       drop_fields: [SN]
     vaksinimi:
       skip: true
````

5. Patient-visit linkage (fuzzy match from ALERT column):

   - For each visit row, extract name from ALERT column
   - Strip asterisks
   - Find matching patient: exact match preferred, then last_word_is_last_name fuzzy
   - On no match: log to migration_errors, skip visit
   - On multiple matches: pick closest DOB if visit has date, otherwise skip

6. Idempotency:

   - All inserts use ON CONFLICT (clinic_id, legacy_id) DO UPDATE
   - Re-runs update existing rows
   - Crashes recoverable: re-run the tool

7. Outputs:

   - migration-report-YYYY-MM-DD.json: source_rows, destination_rows, skipped_rows, warnings_by_field, errors
   - migration-errors.csv: every row that failed, with reason

8. Pre-migration verification:

   - Doctor picks 20-30 known patients
   - Tool produces "spot-check.html" — page showing each patient's source vs target data side-by-side
   - Doctor reviews before cutover

9. Prescription line seeding:
   - During visit migration, parse each Terapia value line-by-line
   - Upsert into prescription_lines (per-doctor index from slice 13)
   - Day-one of using Klinika, autocomplete works with doctor's historical patterns

Constraints:

- Access file (.accdb) NEVER committed to Git
- Migration runs in Postgres transaction per table (commit after each)
- Multi-tenant: every row gets clinic_id from config
- Asterisks stripped, SN dropped, vaccinations skipped

Tests:

- Unit: name splitting strategies
- Unit: date parsing for both formats
- Unit: feeding text → booleans
- Unit: asterisk stripping
- Integration: fixture CSVs → expected Postgres rows
- Integration: re-running migration is idempotent (no duplicates)
- Smoke test: full migration of doctor's actual data on staging, verify counts

Documentation:

- Complete docs/data-migration.md with the full workflow
- Document the spot-check.html report format

Commit on branch `slice-17-migration`.

```

---

# SLICE 18 — Production deploy + on-premise install + DonetaMED cutover

**Goal:** Real deployment. IONOS VPS for klinika.health, on-premise install at DonetaMED, then production cutover.

## Prompt

```

Read CLAUDE.md and docs/decisions/002-deployment-topology.md and docs/deployment.md (will be expanded in this slice).

Build the deployment infrastructure and execute the DonetaMED cutover:

1. Production cloud deployment (IONOS VPS at klinika.health):

   - Provision IONOS VPS in Frankfurt
   - Ubuntu LTS 24.04, Docker, Caddy
   - Configure Cloudflare DNS for \*.klinika.health (wildcard) + klinika.health
   - Caddy auto-TLS with Let's Encrypt DNS challenge
   - Docker Compose stack: web, api, postgres, orthanc-disabled (cloud doesn't need DICOM), pg-boss worker
   - GitHub Actions workflow: tag push → build images → push to GHCR → SSH via Tailscale → docker compose pull && up -d
   - Health check + rollback on failure
   - Run telemetry agent

2. On-premise install at DonetaMED:

   - Mini-PC arrives at clinic
   - Install Ubuntu LTS 24.04, Docker, Caddy
   - Configure Cloudflare Tunnel from clinic to klinika.health (for remote access)
   - Configure split-horizon DNS: donetamed.klinika.health resolves to clinic LAN IP for clinic devices, public IP via tunnel for remote
   - Docker Compose with all services including Orthanc
   - Mount /mnt/dicom-storage on 2TB HDD
   - Configure ultrasound to push DICOM to this Orthanc
   - Run telemetry agent (heartbeats to klinika.health)
   - Schedule encrypted backups to Backblaze B2 (Postgres dump + Orthanc storage, via restic, nightly differential + weekly full)

3. RAID 1 recommendation:

   - Document hardware setup in docs/deployment.md
   - mdadm setup for software RAID 1
   - SMART monitoring alerts

4. Cutover sequence (executed on agreed date):

   - Friday afternoon: backup Access DB, freeze it as read-only
   - Saturday: run migration tool against staging copy first, verify spot-check
   - Saturday afternoon: run migration tool against production Postgres on mini-PC
   - Saturday evening: doctor verifies known patients in production app
   - Sunday: app stays available for any final verification
   - Monday morning: doctor starts using Klinika instead of Access

5. Documentation completion:

   - docs/deployment.md: complete cloud + on-premise procedures
   - docs/runbook.md: complete recovery procedures, alert response
   - docs/data-migration.md: complete migration walkthrough

6. Cloudflare configuration:

   - klinika.health: A record to IONOS IP
   - \*.klinika.health: CNAME to klinika.health
   - admin.klinika.health: behind Cloudflare Access policy (allowlist platform admin email)
   - donetamed.klinika.health: configured for split-horizon DNS

7. Initial DonetaMED tenant setup (after production deploy):

   - Platform admin logs into /admin
   - Creates DonetaMED tenant with subdomain `donetamed`
   - Creates clinic_admin user
   - Doctor and receptionist accounts created
   - Settings configured (logo, signature, working hours, payment codes)

8. Smoke tests after cutover:
   - Receptionist books a test appointment
   - Doctor creates a test visit
   - Doctor links a DICOM study (real scan)
   - Doctor prints a visit report
   - Doctor issues a vërtetim
   - Doctor reviews real migrated patient history
   - All operations succeed without errors

Constraints:

- Doctor trains on app for 1-2 hours in-person before cutover
- Online help reference at klinika.health/help available
- Founder on-call for first 2 weeks post-cutover

Tests:

- Manual smoke tests as listed
- Backup restore tested before cutover (restore Postgres from B2 to test VM, verify integrity)

Documentation:

- All deployment docs complete and verified
- Runbook tested end-to-end

Commit on branch `slice-18-deploy-cutover`.

```

---

## Post-launch (not part of v1 slices)

After cutover, first 2 weeks = observation + bug fixing. No new features. Doctor uses the app, reports issues, you fix them with focused Claude Code sessions.

After 2 weeks: retrospective. What worked? What surprised? What should be in v2?

Likely v2 features:
- DICOM MWL (Modality Worklist) — automatic study-patient linkage
- AI features (clinical summary, smarter autocomplete)
- Appointment reminders
- Marketing landing page at klinika.health
- Onboarding flow for additional clinics
- Billing integration
- TOTP MFA option for platform admins (v1.5)

Each becomes its own slice in a v2 plan.
```
