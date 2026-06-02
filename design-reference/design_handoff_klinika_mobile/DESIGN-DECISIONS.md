# Klinika — Mobile & Tablet design decisions (Phases 1–3)

This document records the decisions baked into `prototype/mobile/klinika-mobile.html`
and the rationale behind them. Phases 1–3 cover every clinic-facing surface.

> **Phase 1 — foundation.** Mobile navigation system, login, doctor home,
> receptionist home, search, profile.
>
> **Phase 2 — patient work.** Patient list, adaptive patient
> chart (split-pane / drilldown), visit detail + new-visit form, DICOM picker
> + lightbox, WHO growth charts.
>
> **Phase 3 — reports, admin, walk-in, linking, errors (this update).** Raporti
> adaptation + print preview, Cilësimet tabs + working hours + payment codes,
> user management, the receptionist walk-in flow + minimal new-patient form,
> the DICOM link-to-visit sheet, and 404/403/500/offline pages.
>
> Platform-admin pages and the full desktop new-patient/print surfaces stay out
> of scope by design.

See **§11 Phase 2** and **§12 Phase 3** below for the per-surface reasoning.

---

## 1. Delivery format — one responsive prototype, Tweaks-driven

Rather than `tablet.html` + `phone.html` per surface, the whole foundation is a
**single responsive React prototype** with a Tweaks panel that toggles:

| Tweak | Options | Affects |
|---|---|---|
| **Pajisja / Madhësia** | Phone · iPad ↕ (portrait) · iPad ↔ (landscape) | device frame + layout |
| **Roli** | Mjeku · Recep. · Admin | nav contents + home screen |
| **Navigimi** (phone only) | Tabs + Më · Tabs · Drawer | phone nav pattern |
| **Gjendja** | Plot · Bosh | populated vs empty state |
| **Ekrani** | Home · Pacientët · Raporti · Profili · Hyrja | jump to any screen |

Why: the brief explicitly asks for a Tweaks panel that switches device size,
role, nav variant, and empty/populated state. A single source of truth keeps
those axes orthogonal and comparable, and matches the existing Raporti tweak
pattern. Reviewers compare a doctor-on-iPhone vs doctor-on-iPad without opening
two files.

The inner app is a **working mini-app**: tapping tabs, the search icon, the
hamburger, and overflow items all navigate for real, which is how feature
parity and nav patterns are best demonstrated.

---

## 2. Breakpoints & device targets

| Form factor | Design size (frame) | Range it represents |
|---|---|---|
| Phone | 390 × 844 | 375 (SE) → 414 (Pro Max), portrait |
| iPad portrait | 768 × 1024 | 768 portrait |
| iPad landscape | 1024 × 768 | 1024 → 1366 landscape |

**Suggested CSS breakpoints for production:**
`768px` = tablet, `1024px` = tablet landscape, `1280px` = desktop (untouched).

The frame auto-scales to fit any viewport (`useFit` in `frame.jsx`) so the
prototype is legible on any screen without the device being clipped.

---

## 3. Navigation

### Phone — bottom tab bar + overflow (default), with two alternates

Default is a **bottom tab bar** with 3 role-aware primary tabs + a **"Më shumë"**
overflow that opens a bottom sheet (profile, settings, help, logout).

- **Why bottom tabs over a pure hamburger:** the doctor uses this *during patient
  visits*. Bottom tabs are reachable one-thumbed, expose the 3 highest-frequency
  destinations permanently, and cost zero taps to orient. A hamburger hides
  everything behind one tap and a cognitive "what's in here?".
- **Why keep an overflow sheet:** clinic roles have 4–5 destinations + account
  actions. Forcing all into 5 tabs crowds the bar and shrinks hit targets;
  "Më shumë" keeps the bar to 4 items (each ≥64px wide) while everything stays
  one-or-two taps away.

Two alternates are toggleable so the team can compare:
- **`Tabs`** — 4 tabs, no overflow (4th = Profili). Honest when a role truly has
  ≤4 destinations.
- **`Drawer`** — hamburger-only, full left drawer with the entire nav + identity
  header. Useful as the "everything in one place" baseline.

**Role-aware tabs**
| Role | Tab 1 | Tab 2 | Tab 3 | Tab 4 |
|---|---|---|---|---|
| Doctor | Sot | Pacientët | Raporti | Më shumë |
| Receptionist | Kalendari | Pacientët | Raporti | Më shumë |
| Clinic admin | Cilësimet | Pacientët | Raporti | Më shumë |

Raporti carries a small badge (unreconciled count) — it exists for all three
clinic roles; only platform_admin lacks it, and platform_admin is out of mobile
scope, so the role-aware filter never has to *hide* Raporti on mobile.

### Tablet — enlarged top nav (no bottom bar)

iPad keeps the **desktop top horizontal nav**, enlarged for touch (64px bar,
≥44px link targets, 15px labels). It carries the same role-filtered links plus a
compact search field (showing the ⌘K hint for keyboard-equipped iPads) and the
user avatar. Rationale: the top nav fits comfortably at ≥768px, preserves
continuity with desktop muscle memory, and frees the bottom edge for content in
the exam room.

### Clinic logo / identity in mobile nav
- **Phone:** the teal brand-mark tile sits at the left of the top app bar (or is
  replaced by the hamburger in Drawer mode; the drawer header then carries the
  full `klinika.health` wordmark + the signed-in identity).
- **Tablet:** full `klinika.health` wordmark at the top-left of the top nav,
  identical to desktop.

---

## 4. Search — ⌘K equivalent = bottom sheet

The desktop ⌘K opens a **bottom sheet** on mobile (iOS convention), triggered by
the search icon in the phone app bar / the search field in the tablet top nav.
The hardware shortcut **⌘K / Ctrl+K still works** (for keyboard-equipped iPads
and the desktop preview). Results show name + DOB + age, with the recency chip
(7d/30d "visited recently") reused from the desktop search panel, and a
"Shto pacient të ri" affordance pinned at the bottom.

We chose a search-triggering app-bar icon over a floating search FAB: a FAB
competes with primary create actions and adds a persistent element over content
during a visit. The icon is conventional and unambiguous.

---

## 5. Home screens

### Doctor home — *more info on tablet* (decision)
- **Phone:** single column — greeting, "Pacienti në vijim" hero (tappable),
  today's appointment agenda with in-list search, mini stats.
- **iPad portrait:** same stack, roomier, + the "Vizitat e sotshme" done-log.
- **iPad landscape:** **two columns** (next-patient + done-log left, full agenda
  right) — closer to the desktop's two-pane richness, since the screen affords it.

### Receptionist home — day-list on phone, Ditë/Javë on tablet
- **Phone:** the desktop week grid does **not** fit a phone, so the canonical
  phone view is a **day-by-day agenda list**: two stat cards (today / tomorrow),
  a `‹ day ›` strip selector, horizontally-scrollable status filter pills, the
  agenda list, and the "Vizita pa termin sot" walk-in band.
- **iPad:** a **Ditë / Javë** segmented toggle. *Ditë* = the same agenda;
  *Javë* = a **compact 6-day week grid** (time axis + status-colored blocks),
  the signature receptionist surface, made readable at tablet width.

The canonical status color system (scheduled→indigo, in-progress→cyan,
completed→green, no_show→amber) is reused verbatim on every card and pill.

---

## 6. Dialogs / sheets

- **Bottom sheets** (rounded top, grip handle, scrim) for search and the
  "Më shumë" overflow — the iOS-native pattern. Dismiss via grip swipe-down
  affordance, scrim tap, or close button.
- **Full-screen takeover** is the intended pattern for long forms (new visit,
  new patient) in Phase 2 — bottom sheets are reserved for quick pickers and
  confirmations.
- The hamburger **drawer** slides from the left (82% width, max 340px).

---

## 7. Touch & accessibility rules

- **Hit targets ≥ 44 × 44px** everywhere (`--m-tap`). Tab bar items, app-bar
  icon buttons, list rows, day-nav chevrons, form inputs, primary buttons.
- **No hover-only affordances.** The desktop calendar's hover-to-expand card and
  hover-suggest walk-in are replaced by tap targets and always-visible content.
- Inputs use **16px font** to prevent iOS auto-zoom on focus.
- `prefers-reduced-motion` disables frame/sheet/scrim transitions.
- Albanian long strings ("Kohëzgjatja", "Administrator i klinikës", "Mungesë")
  are accommodated: tab labels wrap/ellipsis-safe, chips use `white-space:nowrap`
  with room, the Tweaks segmented control falls back to a dropdown past its
  width budget.

---

## 8. New mobile tokens (added in `mobile.css`)

All existing teal / warm-neutral / status / type tokens are **reused unchanged**.
New tokens are `--m-`prefixed:

```
--m-tap: 44px            min touch target
--m-gutter / --m-gutter-lg: 16 / 24px   phone / tablet horizontal gutter
--m-appbar-h: 52px       phone top app bar
--m-tabbar-h: 58px       phone bottom tab bar
--m-statusbar-phone/tablet, --m-home-indicator   device chrome
--m-sheet-radius: 22px
--m-s1…--m-s8            mobile spacing scale (4→32px)
--bezel / --bezel-edge   device frame color
```

---

## 9. Which components need mobile-specific variants vs responsive CSS

| Pattern | Approach |
|---|---|
| Buttons, inputs, chips, role-chips, filter-pills, status colors, cards | **Reuse desktop CSS** — only sizing nudged via mobile tokens |
| Top navigation | **New variants** — phone app bar + bottom tab bar; tablet enlarged top nav |
| Calendar (week grid) | **New mobile variant** — day-list on phone, compact week grid on tablet |
| Patient chart (Phase 2) | **New variant** — split-pane on desktop → drilldown on phone; tablet TBD in Phase 2 |
| Modals | **New variant** — centered overlay → bottom sheet / full-screen |
| Search | **New variant** — dropdown → bottom sheet |

---

## 10. PWA / native feel
- `theme-color` meta set to teal; `viewport-fit=cover` for safe areas.
- iOS-style status bar + home indicator rendered inside the frame.
- Pull-to-refresh hint shown on the doctor agenda (gesture wiring is a Phase 4
  refinement).

---

## Open questions carried into later phases
- Print of Raporti from iPad: confirmed in-scope; exact print path designed in Phase 3.
- New-patient form (/pacient/new): currently flashes a "Faza 3" toast from the
  list FAB — build in Phase 3 alongside the receptionist walk-in flow.

---

## 11. Phase 2 — patient work

### 11.1 Patient list (`/pacientet`)
- **List, never a table** — even on tablet. A two-line row (avatar, name + sex
  pill + DOB, last diagnosis) reads faster one-handed and scales from 375px to
  1366px with no horizontal scroll. Tables force either truncation or sideways
  scrolling on a phone; the row already carries everything the doctor scans for.
- **Privacy boundary respected.** `role === "reception"` sees **name + DOB only**
  (plus a recency chip); the last-diagnosis line and visit-count chip are
  doctor/admin-only. Driven by the `role` prop, not CSS hiding.
- **Pinned search** at the top (sticky, blurred) + a sort/filter button. Search
  is the primary find path; alphabetical is the default order.
- **Sex-tinted avatars** (rose / blue) echo the chart's growth-curve convention
  so the same child reads the same color across surfaces.
- **FAB** (+) for new patient — thumb-reachable, doesn't compete with row taps.

### 11.2 Patient chart — adaptive split vs drilldown (the headline decision)
Confirmed product decision, implemented at the **1024px** boundary:

| Device | Pattern | Why |
|---|---|---|
| **iPad landscape (≥1024px)** | **Split-pane** — visit list (340px) + visit detail side by side | Doctor reads history while entering today's notes without losing context. Matches iPadOS multi-column apps (Mail, Notes, Files). |
| **iPad portrait + phone** | **Single-pane drilldown** — chart tabs → tap visit → detail; back returns | Not enough width for two readable columns; tap-drill is the universally-understood phone pattern. |

- **Master strip stays pinned** across both — patient identity (avatar, name,
  sex, age, DOB, key vitals, allergy band) is always visible so the doctor never
  loses track of *whose* chart this is. This is the mobile reduction of the
  desktop `.master` strip.
- **Chart sections = a scrollable segmented tab row**: `Vizitat · Rritja ·
  Ultrazëri · Të dhëna`. Counts (visit count) and a "re" badge (unlinked DICOM)
  ride on the tabs. Albanian labels fit; the row scrolls horizontally if a
  longer translation ever overflows.
- **Default selection (split-pane):** the **most recent visit** opens first —
  it's the in-progress / today's visit when one exists, which is what the doctor
  reaches for. Empty right-pane shows a "choose a visit" prompt.
- **Fixed split, not resizable.** A draggable divider is desktop ergonomics;
  on touch it's fiddly and rarely used. 340px left pane is tuned so visit rows
  stay legible while the form gets the bulk of the width.
- **"New visit"** appears as a secondary button in the left pane (landscape) and
  as a **FAB** on the drilldown Vizitat tab — same affordance, position tuned to
  layout.

### 11.3 New / detail visit form
- **Single long vertical scroll**, sectioned exactly like desktop (Vizita →
  Ekzaminimi → Diagnoza → Terapia → Plani → Pagesa). No accordions — scrolling a
  known order beats hunting collapsed panels mid-consult.
- **Sticky bottom save bar** with an inline autosave indicator ("Ruajtur 14:18"
  / "Po ruhet…") on the left and the primary action ("Përfundo vizitën" /
  "Ruaj vizitën") on the right. New-visit adds an "Anulo".
- **Full-screen takeover on phone** — bottom tabs + app-bar search/profile hide
  so the form is a focused, distraction-free surface (per the calm-clinic
  principle). The app bar shows back + a contextual title.
- **Validation inline, not as a banner** — required fields (e.g. Ankesa) show a
  red border + a short message under the field on blur. Banners scroll out of
  view; inline errors sit where the fix happens.
- **Payment code = bottom-sheet picker**, not a dropdown. Each option is a 56px
  row (code tile + label + amount + tick) — far better touch ergonomics than a
  native `<select>`, and it shows the price next to each code.
- **Receptionist edit-lock** ("Vetëm shikim. Mjeku duhet të shënojë statusin…")
  renders as a calm neutral banner at the top of the form; clinical fields are
  `disabled`, but the **Pagesa** section stays editable (reception owns billing).

### 11.4 DICOM picker + lightbox
- **Picker = scrollable card list.** Each study card: modality tag + title +
  date header, a 4-up thumbnail strip, and a footer showing link state. Tablet
  shows two cards per row.
- **Unlinked studies** (fresh from the US machine, no visit yet) get a teal
  border, a top info banner with the count, and a "Lidh me vizitën" action —
  the link flow opens as a bottom sheet on mobile (vs the desktop dialog).
- **Filter chips** (`Të gjitha · Sot · Më herët · Të palidhura`) are
  horizontally scrollable, reusing the status-pill styling.
- **Lightbox = fullscreen over the device screen** (not a windowed modal, on
  either form factor — ultrasound detail needs every pixel). Dark `#050404`
  backdrop, top bar (title + counter + metadata toggle + close), **swipe between
  images**, dot indicators, pinch-to-zoom hint, and a glass action row
  (Lidh / Shkarko). Metadata overlay is toggleable so it never blocks the image.
- **Ultrasound imagery is a placeholder** — a dark scan-cone gradient with a
  mono caption (`KLINIKA · US · date · IM-01`), never a hand-drawn organ. Real
  DICOM frames drop in later.

### 11.5 WHO growth charts
- **Sparkline cards stack** — 1 column on phone, 2 on tablet portrait, 3 on
  landscape. Each card shows the metric, current percentile, the curve, and the
  latest value. No horizontal scroll for the *overview*.
- **Tap → fullscreen lightbox** with a metric tab row (Pesha / Gjatësia / Perim.
  kokës), a current-value pill, the full axed chart, and a measurement table.
- **The detailed chart scrolls horizontally inside the lightbox on phone**
  (min-width 480px) rather than shrinking below readability — a growth chart
  has a minimum legible size; squashing it to 320px would make the percentile
  bands meaningless. On tablet it fits without scroll.
- **Percentile bands stay neutral; the patient series is sex-tinted** (rose for
  girls, blue for boys), exactly as desktop — clinical reading is never colored
  by sex, only the child's own line is.
- Charts are **pure generated SVG** from WHO reference fixtures (P3/P15/P50/P85/
  P97), responsive via `viewBox`.

### 11.6 New mobile tokens / patterns added in Phase 2
No new `:root` tokens were required — Phase 2 reuses the Phase 1 `--m-*` scale.
New **component patterns** (all in `mobile-patient.css`):
`.ms-master` (patient identity strip) · `.ms-charttabs` (segmented chart nav) ·
`.ms-split` (split-pane grid) · `.ms-vform` / `.ms-vsection` / `.ms-vital` /
`.ms-dx-chip` (mobile visit form) · `.ms-payopt` (payment sheet rows) ·
`.ms-savebar` (sticky save) · `.ms-study` + `.us-img` (DICOM cards / placeholder) ·
`.ms-lightbox` (fullscreen image viewer) · `.ms-gcard` + `.gx-*` (growth SVG) ·
`.ms-subbar` (tablet contextual back bar).

### 11.7 Touch-target & a11y notes (Phase 2)
- Visit rows, payment options, chart tabs, study cards, lightbox controls,
  growth cards: all ≥44px. Form inputs use 16px text (no iOS zoom).
- Lightbox swipe has mouse fallbacks so it's testable on desktop preview.
- DICOM/growth lightboxes trap within the device screen (absolute, not fixed),
  consistent with the frame model.

---

## 12. Phase 3 — reports, admin, walk-in, DICOM linking, errors

### 12.1 Raporti (`/raporti`)
- **Three tiles, revenue first and biggest.** On phone they stack vertically
  (revenue → count → status), revenue rendered at 44px as the hero numeral
  since end-of-day takings are what the clinic checks first. Tablet portrait =
  2 columns, tablet landscape = 3 across (matching the desktop sibling-tile feel).
- **Status tile = stacked bar + legend**, reusing the canonical status solids
  (completed/green, no_show/amber, scheduled/indigo) — same viz language as the
  desktop Direction A.
- **Filter pills** are the shared `.filter-pill` component, horizontally
  scrollable on phone, wrapping on tablet.
- **Visits adapt: card list on phone, real table on tablet.** A 5-column table
  (ora/pacienti/statusi/kodi/pagesa + total row) is legible at ≥768px; on a
  phone it would force horizontal scroll, so each visit becomes a compact card
  (time · name+age+status · payment) instead.
- **Print is prominent**, not secondary — it's an explicit success criterion
  ("doctor prints the daily report from the iPad"). A sticky bottom bar carries
  the running total + a primary **Printo** button.
- **Receptionist scope**: a neutral banner states the today/yesterday limit and
  the forward date arrow is disabled — privacy/permission boundary made visible.

### 12.2 Print preview
- **Simplified preview + one big button**, not a faithful paper re-render. A
  white "paper" card shows the clinic header, a summary block, and revenue by
  code with a bold total; a sticky footer has **Printo raportin** (calls
  `window.print()`). Slides up over the screen like the other full-takeovers.

### 12.3 Cilësimet (`/cilesimet`)
- **Horizontal-scrolling tab row** at the top (Përgjithshme · Orari dhe terminet
  · Përdoruesit · Pagesa · Email · Auditimi), not a bottom-sheet picker or
  accordion. Rationale: the desktop uses a left sidebar of peer sections; a
  scrolling segmented row is the closest mobile analogue, keeps every section
  one tap away, and shows the active section in context. A bottom-sheet picker
  hides the section list behind a tap; accordions bury long forms.
- **Sticky save bar** with an autosave indicator on every editable pane.
- **Toggles, working-hours rows (per-day open/closed + time inputs), and a
  payment-code list** all reuse ≥44px touch rows. Albanian day names
  ("E mërkurë") fit the fixed label column.

### 12.4 User management
- **Grouped list** (Mjekë / Recepsion / Administratorë) with role chips, not a
  flat list or a table — grouping answers "who can do what" at a glance, and a
  user with two roles (Dr. Taulant = doctor + admin) appears under both with
  both chips. Lives **inside Cilësimet** as the Përdoruesit tab (matches
  desktop), reachable on its own from the admin home tab too.
- **Add/edit = full-screen takeover** (consistent with the visit form), not a
  step-by-step sheet: name + email + a **multi-select role picker** (checkable
  rows describing each role's scope), an active/inactive toggle when editing,
  and a **"Dërgo reset të fjalëkalimit"** action. A flat one-screen form is
  faster than wizard steps for 3 short fields.

### 12.5 Walk-in flow (receptionist's primary mobile use case)
- **Two entry points**: a prominent full-width **"Vizitë pa termin"** button at
  the top of the receptionist home (right under the stat cards) AND a FAB —
  the button is discoverable/explicit, the FAB is thumb-reachable while holding
  a tablet one-handed.
- **Search-or-create, one field.** The receptionist types a name; existing
  patients surface as tappable suggestions, and a persistent **"Krijo pacient
  të ri"** banner (carrying the typed text) is always offered above them — so
  the create path is never more than one tap away and the typed name is reused.
- **Visit is created immediately** and the flow hands off into the visit form
  (doctor sees it in their list) — matches the "created immediately" requirement.

### 12.6 Minimal new-patient form
- **Required only**: emër, mbiemër, datëlindje, gjini (sex as a rose/blue
  segmented control matching the chart tint). **Optional**: guardian phone,
  address. A teal banner states explicitly that the **doctor completes
  allergies/notes/history later on desktop** — the full form stays desktop-only
  per the locked decision. Keyboard-friendly: `inputMode` set per field, 16px
  inputs, sticky "Krijo & hap vizitën".

### 12.7 DICOM link-to-visit bottom sheet
- Opens from an unlinked study (picker card or lightbox action). Top is a
  **verification header showing the DICOM `patient_name`** with a check icon;
  if it differs from the open chart, the header turns amber and a **mismatch
  warning** appears ("verifiko para se ta lidhësh").
- **Recent visits = last 30 days** (here 3), each a row with date · time ·
  status chip · payment code and a **"Lidh me këtë"** button that confirms
  inline (→ "E lidhur"). A **"Lëre i palidhur"** escape sits at the bottom.
- **Multi-image studies link together**: a note states all N images attach to
  the chosen visit (the common abdomen+thyroid-in-one-session case), rather than
  forcing per-image linking.

### 12.8 Error / offline pages
- **Icon-only, no illustrations** (per the house style — no hand-drawn SVG art).
  A rounded neutral icon tile, a mono `GABIM 404` code line, title, one-line
  explanation, and CTAs. 404/403 → **"Kthehu te ballina"**; 500 → **"Provo
  përsëri"** + secondary home; offline → a calm "check the clinic WiFi" message
  with **"Provo përsëri"**. The error kind is a Tweak so all four are reviewable.

### 12.9 New tokens / patterns added in Phase 3
No new `:root` scale tokens. Two missing **chip variants** were added
(`.chip-indigo` = scheduled status, `.chip-neutral`) plus component patterns in
`mobile-phase3.css`: `.ms-rp-tile` / `.ms-rp-status` / `.ms-rp-table` (raporti) ·
`.ms-print` (print preview) · `.ms-settabs` / `.ms-set-card` / `.ms-switch` /
`.ms-hours-row` / `.ms-code-row` (settings) · `.ms-user-row` / `.ms-role-opt`
(users) · `.ms-walkin-btn` / `.ms-create-banner` / `.ms-sex-seg` (walk-in) ·
`.ms-link-verify` / `.ms-link-visit` (DICOM link) · `.ms-errpage` (errors).

### 12.10 Status after Phase 3
All clinic-facing surfaces now have mobile/tablet designs. Out of scope and
unbuilt by intent: offline-first sync, native push, voice, AR/camera, and
platform-admin pages (desktop only).

---

## 13. Role completeness + privacy enforcement (review fix)

A review found that switching the Tweaks **role** changed nav chips but the
**patient chart rendered the full clinical view for every role** — a privacy
breach for the receptionist. The role surfaces are now fully differentiated and
the privacy boundary is enforced in the *rendered page*, not just the nav.

### 13.1 What each role actually renders (verified live)
| Surface | Doctor | Receptionist | Clinic admin |
|---|---|---|---|
| Home | Pamja e ditës (agenda + next patient) | Kalendari (stats, day list, walk-in CTA + FAB) | Cilësimet (default tab) |
| Patient list | name + age + dx + visit count | **name + DOB + age only** | name + age + dx (full) |
| Patient chart | full clinical (Vizitat/Rritja/Ultrazëri/Të dhëna, split-pane on landscape) | **restricted: Terminet + Të dhëna only** | full clinical |
| Visit form | full editable | **never reachable** | full editable |
| Raporti | all dates | **today + yesterday only** (ADR-019 cash carve-out) | all dates |
| Cilësimet | available | — | full (6 tabs) |
| Profile | yes | yes | yes |

### 13.2 Receptionist privacy boundary (the fix)
- `PatientChart` now branches on `role === "reception"` → **`ReceptionChart`**, a
  restricted view that shows **only**: identity master strip (name, sex, DOB,
  age, patient ID), an **appointment history** (date · time · status chip — no
  diagnosis, no payment, no clinical), and a **contact** tab (guardian, phone,
  address). No allergy band, no birth/vitals stats, no growth, no DICOM.
- A persistent lock banner states the boundary explicitly: *"Recepsioni sheh
  vetëm emrin, datëlindjen dhe terminet. Të dhënat klinike janë vetëm për mjekun."*
- The receptionist **can never open the clinical visit form**: from the chart
  the only action is **"Vizitë pa termin"**, which launches the walk-in flow.
  Completing walk-in returns the receptionist to the **day view** (the doctor
  picks up the clinical visit) — the clinical form is never shown to reception.
- Patient **list** already hides diagnosis + visit count for reception; the
  **search** results show name + DOB only.

### 13.3 Clinic admin home + surfaces
- Admin's **home is Cilësimet** (the settings tab is the home key), with bottom
  tabs Cilësimet · Pacientët · Raporti · Më shumë.
- All six settings tabs are built and populated: **Përgjithshme** (clinic
  identity), **Orari dhe terminet** (7 per-day open/closed rows + duration
  selects), **Përdoruesit** (grouped users + add/edit form + password-reset),
  **Pagesa** (5 codes — A 15€ · B 10€ · C 5€ · D 20€ · E Falas), **Email**
  (notification toggles), **Auditimi** (change log). Each editable pane has a
  sticky autosave bar.

### 13.4 Why admin is not privacy-restricted on patient data
The CLAUDE privacy boundary is scoped to the **receptionist**. Clinic admin
retains full clinical visibility (matching desktop), so this layer only adds the
receptionist restriction. If a future ADR restricts pure clinic_admins, the same
role-branch pattern applies.


## File map
```
prototype/mobile/
  klinika-mobile.html      shell — loads React, tweaks panel, styles, screens
  mobile.css               tokens + frame + nav + sheets chrome
  mobile-screens.css       per-screen styles
  data.jsx                 shared fixtures + icon set
  frame.jsx                device bezel + auto-fit + status bar
  nav.jsx                  role config + app bar / tabs / drawer / top nav / search
  screens-doctor.jsx       doctor home
  screens-reception.jsx    receptionist home + compact week grid
  screens-shared.jsx       login + profile + Phase 3 placeholders
  data-patient.jsx         patient/visit/growth/DICOM fixtures + WHO data
  screens-patient.jsx      patient list + adaptive chart (split/drilldown)
  screens-visit.jsx        visit form + payment sheet + sticky save
  screens-dicom.jsx        DICOM picker + fullscreen lightbox
  screens-growth.jsx       WHO growth sparklines + lightbox (generated SVG)
  mobile-patient.css       Phase 2 styles (chart, form, dicom, growth)
  data-phase3.jsx          raporti / users / settings / hours / error fixtures
  screens-raporti.jsx      Raporti (3 tiles, card-list/table, print preview)
  screens-settings.jsx     Cilësimet tabs + working hours + codes + user mgmt
  screens-walkin.jsx       walk-in flow + minimal new-patient form
  screens-error.jsx        404/403/500/offline + DICOM link-to-visit sheet
  mobile-phase3.css        Phase 3 styles (raporti, settings, walk-in, errors)
  app.jsx                  shell composition + patient routing + Tweaks
```
