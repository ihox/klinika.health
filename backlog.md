# Backlog

Deferred follow-ups captured during in-flight work. Items here are not
in-progress; they're parked until someone picks them up. Keep entries
brief — file paths, effort estimate, priority, and a pointer to the
original work that surfaced the need.

---

## test(e2e): migrate kalendari mocks from /api/appointments/* to /api/visits/calendar/*

- **Files:** `apps/web/tests/e2e/kalendari.spec.ts`
- **Scope:** The receptionist calendar UI now calls `/api/visits/calendar/*` (per ADR-011's appointments + visits unification), but `kalendari.spec.ts` still mocks the legacy `/api/appointments/*` shape. Three tests currently fail as a result (initial render, mark-kryer, end-of-day prompt). Re-write the `mockApi` helper to fulfil the new endpoint shapes (`/api/visits/calendar`, `/api/visits/calendar/stats`, `/api/visits/calendar/unmarked-past`, `/api/visits/calendar/stream`, `PATCH /api/visits/calendar/:id`).
- **Effort:** ~30–60 min — requires inspecting the new endpoint payloads in `apps/web/lib/visits-calendar-client.ts` and `apps/api/src/modules/visits/visits-calendar.service.ts` rather than a mechanical rename.
- **Priority:** medium (3 e2e tests are red until this lands)
- **Reference:** surfaced during the shared auth-fixture migration that fixed the broader `useMe`-redirect failures.

## design(prototype): remove cancelled status from design-reference/prototype/

- **Files:** receptionist.html, doctor.html, overview.html, styles.css, tokens/*
- **Scope:** remove all cancelled UI references + `--status-cancelled-*` tokens
- **Effort:** ~45–60 min Claude Design pass
- **Priority:** medium (prototype is reference, not deployed code)
- **Reference:** commit 1492868 removed these from the app, prototype still carries them

## docs: revise lifecycle docs to reflect 5-state model

- Any ADR or status-lifecycle doc referencing the old 6-state set (with cancelled) should be updated
- The canonical states are now: scheduled / arrived / in_progress / completed / no_show
- **Effort:** ~30 min
- **Priority:** low (internal docs, no user impact)

## ui(payment-code): expand payment-code alphabet to include E (and U if clarified)

- **Files:** any UI surface that renders `visits.payment_code` (chart, day-stats card, print templates); clinic seed `paymentCodes` JSON
- **Scope:** Klinika UI/seed currently assume the alphabet `{A, B, C, D}`. ADR-016 migrates `E` as-is (22.32% of DonetaMED's visits, 14,184 rows). Add the label/colour for `E` in `clinics.payment_codes` and update any switch/lookup that defaults `E` to a fallback.
- **Also:** the `U` code appears 52 times in the live source with unknown semantics — ask Dr. Taulant; if clarified, add it to `_KNOWN_PAYMENT_CODES` in `tools/migrate/klinika_migrate/visits.py` and drop the `payment_code_unknown_letter` warning for U specifically.
- **Effort:** ~1-2h once the label/colour decisions are made
- **Priority:** medium (E is visible on 22% of migrated visits; renders as "unknown code" without this fix)
- **Reference:** ADR-016, slice 17 STEP 6 dry-run
