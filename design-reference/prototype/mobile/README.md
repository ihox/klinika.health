# Handoff: Klinika — Mobile & Tablet (clinic app)

## Overview
Klinika is a pediatric-clinic management app (Albanian-language UI) that was
desktop-only. This package adds **responsive mobile + tablet support** for all
clinic-facing surfaces across three roles: **doctor**, **receptionist**, and
**clinic admin**. It covers navigation, login, the doctor's day view, the
receptionist calendar + appointment scheduling + walk-in flow, the patient chart
(with an adaptive split-pane/drilldown pattern), the visit form, the DICOM
ultrasound picker/lightbox, WHO growth charts, the daily report (Raporti),
clinic settings, user management, and error/offline pages.

Target devices: **phone** (375–414px portrait), **iPad portrait** (768px),
**iPad landscape** (1024–1366px). Desktop is untouched.

---

## About the design files
The files in this bundle are **design references created in HTML/React+Babel** —
a single interactive prototype that demonstrates the intended look, layout, and
behavior. **They are not production code to copy directly.** The Babel-in-browser
setup, the on-screen device bezel/frame, and the Tweaks panel are prototyping
scaffolding only.

The task is to **recreate these designs in the Klinika codebase's existing
environment**, using its established framework, component library, router, and
data layer. The desktop app already exists — reuse its real components, design
tokens, and API/data hooks; this is a **mobile/tablet extension of the existing
product**, not a new app or a new identity.

If you are unsure which desktop component a mobile screen maps to, the desktop
prototypes referenced in `DESIGN-DECISIONS.md` (e.g. `chart.html`,
`raporti-app.jsx`, `clinic-settings.html`, `receptionist.html`) are the source
of truth for clinical content and copy.

---

## Fidelity
**High-fidelity.** Final colors, typography, spacing, status colors, and
interactions are all specified and reuse the existing Klinika desktop design
tokens. Recreate the UI faithfully using the codebase's existing libraries and
patterns. The one deliberate placeholder is **ultrasound imagery** (a dark
scan-cone gradient) — wire real DICOM frames in its place.

---

## Read this first: the authoritative spec
**`DESIGN-DECISIONS.md`** (included in this bundle) is the primary specification.
It documents every surface, the rationale, the responsive breakpoints, the
privacy boundaries, touch-target rules, and the component-variant map, organized
by phase (§1–§13). This README is the orientation layer; that file is the detail.

---

## Roles & privacy boundaries (critical)
Enforce these in the rendered views, not just navigation:

| Surface | Doctor | Receptionist | Clinic admin |
|---|---|---|---|
| Home | Day view (agenda + next patient) | Calendar (stats, day/week, scheduling) | Settings |
| Bottom tabs | Sot · Pacientët · Raporti · Më shumë | Kalendari · Raporti · Më shumë | Cilësimet · Pacientët · Raporti · Më shumë |
| Patient list | name + age + dx + visit count | **name + DOB + age ONLY** | full |
| Patient chart | full clinical (Vizitat/Rritja/Ultrazëri/Të dhëna) | **Terminet + Të dhëna only** (no clinical) | full clinical |
| Visit form | full editable | **never reachable** (clinical fields locked) | full editable |
| Raporti | all dates | **today + yesterday only** | all dates |

**Receptionist must never see clinical data** (diagnoses, allergies, vitals,
growth, ultrasound, payment codes). The receptionist chart shows only identity,
appointment history (date/time/status), and guardian contact.

---

## Breakpoints
- `< 768px` → **phone** layout (bottom tab bar + top app bar; single-pane)
- `768px–1023px` → **tablet portrait** (top nav; single-pane drilldown; day-list calendar)
- `≥ 1024px` → **tablet landscape** (top nav; **split-pane** chart; **week-grid** calendar default)
- `≥ 1280px` → existing desktop (untouched)

---

## Navigation patterns
- **Phone:** top app bar (brand/back + title + search + avatar) + **bottom tab bar**
  (role-aware, 3 primary tabs + "Më shumë" overflow sheet). An alternate
  hamburger-drawer variant exists in the prototype but bottom-tabs is the default.
- **Tablet:** the desktop top horizontal nav, enlarged for touch (64px bar,
  ≥44px targets) — no bottom bar.
- **Search** = a bottom sheet (the ⌘K equivalent); the keyboard shortcut still
  works for iPad keyboards.
- **Dialogs:** bottom sheets for pickers/confirmations (swipe-to-dismiss);
  full-screen takeover for long forms (visit, new user, scheduling).

---

## Screens / Views
Each is implemented in the prototype; see the file map below and
`DESIGN-DECISIONS.md` for full per-screen detail.

1. **Login** — email/password, role hint toggle, Cloudflare Access via browser flow.
2. **Doctor home (Pamja e ditës)** — greeting, "Pacienti në vijim" hero card
   (next patient: diagnosis + reason on left, weight/height/head-circumference
   stacked on right), today's appointment list. Tablet landscape = 2 columns.
3. **Receptionist home (Kalendari)** — two stat cards (today/tomorrow),
   **Cakto termin** (primary) + **Pa termin** (secondary) actions, day-list
   agenda + walk-in band. **Tablet landscape defaults to a week calendar grid**;
   portrait/phone default to day-list, with a Ditë/Javë toggle.
4. **Appointment scheduling** — search-or-create patient → pick **date** (day
   strip) + **Kohëzgjatja** (10/15/20/40 min) + **time slot** (grid recomputed
   from length & working hours, booked slots disabled). Mode toggle:
   "Cakto termin" (scheduled) vs "Tani · pa termin" (immediate).
5. **Minimal new-patient form** — required: emër, mbiemër, datëlindje, gjini
   (sex segmented control). Optional: guardian phone, address. Full clinical
   form stays desktop-only.
6. **Patient list (Pacientët)** — pinned search + sort, list rows (not a table),
   sex-tinted avatars, FAB. Privacy-filtered per role.
7. **Patient chart** — **adaptive**: split-pane (visit list + detail) at ≥1024px,
   single-pane drilldown (segmented Vizitat/Rritja/Ultrazëri/Të dhëna tabs) below.
   Pinned master strip (identity + vitals + allergy band).
8. **Visit form** — sectioned (Vizita → Ekzaminimi → Diagnoza → Terapia → Plani
   → Pagesa), sticky save bar with autosave, inline validation, ICD-10 chips,
   payment-code bottom-sheet picker. Full-screen on phone.
9. **DICOM picker + lightbox** — study cards (4-up thumbnails), unlinked-study
   banner, filter chips; fullscreen lightbox (swipe, dots, metadata toggle).
10. **DICOM link-to-visit sheet** — verification header (DICOM patient name +
    mismatch warning), last-30-days visit list, "leave unlinked" escape.
11. **WHO growth charts** — sparkline cards (stack 1/2/3 cols by device) →
    fullscreen lightbox with metric tabs, axed SVG chart, data table. Patient
    series sex-tinted (rose/blue); percentile bands neutral.
12. **Raporti (daily report)** — three tiles (revenue first/biggest on phone),
    status stacked bar, filter pills; visits as a **card list on phone, table on
    tablet**; date arrows + Sot.
13. **Cilësimet (settings)** — horizontal-scroll tab row (Përgjithshme · Orari
    dhe terminet · Përdoruesit · Pagesa · Email · Auditimi), sticky save bar,
    toggles, per-day working-hours rows, payment codes.
14. **User management** — grouped by role with role chips; add/edit full-screen
    form with multi-select role picker, active toggle, password-reset trigger.
15. **Profile** — identity, role chips, security (password, MFA), logout.
16. **Error / offline** — 404 / 403 / 500 / offline; icon-only, role-appropriate CTAs.

---

## Interactions & behavior
- **Touch targets ≥ 44×44px** everywhere. No hover-only interactions.
- **Inputs use 16px font** to prevent iOS focus-zoom.
- Bottom sheets: swipe-down or scrim-tap to dismiss; transform-based slide
  (320ms `cubic-bezier(.22,.61,.36,1)`).
- DICOM lightbox: horizontal swipe between images (with mouse fallback);
  pinch-zoom intended (hint shown).
- Visit form: autosave indicator ("Ruajtur 14:18" / "Po ruhet…"); inline
  required-field errors on blur (red border + message), not banners.
- Scheduling: changing **Kohëzgjatja** recomputes the time-slot grid; days past
  working hours / Sundays are disabled.
- `prefers-reduced-motion`: disable frame/sheet/scrim transitions.

---

## State management (per screen, recreate with the app's real data layer)
- **Role / device** are prototype Tweaks only — in production these come from
  auth/session and viewport, respectively.
- Patient chart: selected visit (split-pane default = most recent / today's
  in-progress), active tab, lightbox open + index, growth-metric, link-sheet.
- Visit form: field values, payment code, food checks, diagnosis chips, saving.
- Scheduling: chosen patient, mode (schedule/walk-in), day index, length, slot.
- Settings: active tab, per-day hours, toggle states, user add/edit sub-view.
- Data fetching: patient list/search, patient detail + visits, DICOM studies,
  WHO reference data, daily-report aggregation, users, clinic settings.

---

## Design tokens
**Reuse the existing Klinika desktop tokens** (`prototype/styles.css` /
`tokens/design-tokens.css`): teal primary (`--primary`, `--teal-*`), warm-neutral
backgrounds/text, canonical status colors (scheduled=indigo, in-progress=cyan,
completed=green, no_show=amber), role-chip colors (doctor=indigo,
reception=violet, admin=slate), radii, shadows, and the Inter / Inter Tight /
JetBrains Mono families.

**Mobile-only tokens added** (in `mobile.css`, all `--m-`prefixed):
```
--m-tap: 44px              minimum touch target
--m-gutter / --m-gutter-lg: 16px / 24px   phone / tablet horizontal gutter
--m-appbar-h: 52px         phone top app bar height
--m-tabbar-h: 58px         phone bottom tab bar height
--m-statusbar-phone/tablet, --m-home-indicator   device chrome
--m-sheet-radius: 22px     bottom-sheet corner radius
--m-s1…--m-s8: 4 8 12 16 20 24 32px   mobile spacing scale
--bezel / --bezel-edge     device-frame colors (prototype chrome only)
```
Two chip variants were added on top of the desktop set: `.chip-indigo`
(scheduled status) and `.chip-neutral`. Payment codes: A 15€ · B 10€ · C 5€ ·
D 20€ (ultrasound) · E Falas.

---

## Assets
- **Brand mark**: a small teal "pulse/EKG" SVG glyph (inline) — reuse the
  existing Klinika logo from the codebase.
- **Icons**: a minimal inline stroke set (1.6 weight) defined in `data.jsx`
  (`Icon` component). Map these to the codebase's existing icon library where
  equivalents exist.
- **Ultrasound images**: PLACEHOLDER ONLY (CSS dark scan-cone). Replace with the
  real DICOM image pipeline.
- **Avatars**: initials on a colored circle (sex-tinted in clinical contexts).

---

## Files in this bundle
- `DESIGN-DECISIONS.md` — **the authoritative spec** (read first).
- `klinika-mobile.html` — entry point; loads React + all screens + styles.
- `mobile.css` — device frame, nav chrome, sheets, mobile tokens.
- `mobile-screens.css` — Phase 1 screen styles (home, login, profile, calendar).
- `mobile-patient.css` — Phase 2 styles (chart, visit form, DICOM, growth).
- `mobile-phase3.css` — Phase 3 styles (raporti, settings, walk-in, scheduling, errors).
- `data.jsx` — icon set + shared fixtures (doctor/reception home).
- `data-patient.jsx` — patient/visit/growth/DICOM fixtures + WHO reference data.
- `data-phase3.jsx` — raporti/users/settings/hours/error fixtures.
- `frame.jsx` — device bezel + auto-fit scaling + status bar (prototype chrome).
- `nav.jsx` — role config + app bar / bottom tabs / drawer / tablet top nav / search.
- `screens-doctor.jsx` — doctor home.
- `screens-reception.jsx` — receptionist home + week grid.
- `screens-shared.jsx` — login + profile + placeholders.
- `screens-patient.jsx` — patient list + adaptive chart + receptionist restricted chart.
- `screens-visit.jsx` — visit form + payment sheet.
- `screens-dicom.jsx` — DICOM picker + lightbox.
- `screens-growth.jsx` — WHO growth sparklines + lightbox (generated SVG).
- `screens-raporti.jsx` — daily report.
- `screens-settings.jsx` — settings tabs + user management.
- `screens-walkin.jsx` — scheduling + walk-in + minimal new-patient.
- `screens-error.jsx` — error pages + DICOM link-to-visit sheet.
- `app.jsx` — shell composition + routing + Tweaks (prototype harness).

The desktop prototypes (in the parent `prototype/` folder, not bundled here) are
the reference for clinical content/copy: `chart.html`, `raporti-app.jsx`,
`clinic-settings.html`, `receptionist.html`, `doctor.html`.

---

## Out of scope (do not build)
Offline-first sync, native push notifications, voice input, AR/camera, Apple
Pencil, and **platform-admin pages** (desktop only). Print previews were
de-scoped on mobile.
