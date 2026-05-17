# Klinika Backlog

## Known deferred issues (documented in ADRs)
- See ADR 011 for visits merge follow-ups
- See ADR 008 (Middleware fix section) for soft-delete details
- See ADR 006 (DATE handling fix section) for date column patterns

## Local dev environment
- Puppeteer/Chrome fails to launch on Apple Silicon (Rosetta) — local only
- Local integration tests blocked by psql 18.3 + Prisma URL param compatibility
- TelemetryService.onApplicationBootstrap fails in @nestjs/testing harness

## CI / test infrastructure
- test(ci): enable print integration tests in CI
  - Blocker: vitest uses esbuild which doesn't emit decorator
    metadata for NestJS DI
  - Fix: install + configure unplugin-swc in
    apps/api/vitest.config.ts
  - Then: add postgres-service to CI job + run print integration
    suite
  - Effort: ~3-4 hours
  - Priority: high — most valuable test prevention layer for
    catching schema/template drift before manual smoke
  - Reference: print.integration.spec.ts has inline notes on the
    specific blocker

## Recurring operations
- Sex-inference dictionary correction loop (Slice 17.5 follow-up):
  the apply step marks Claude-inferred sex with
  `patients.sex_inferred = true`. When Dr. Taulant manually corrects
  one of those rows in the UI, the row should flip to
  `sex_inferred = false` (the doctor's value, no longer inferred).
  Quarterly:
    1. Query rows where `legacy_id IS NOT NULL` and
       `sex_inferred = false` and `sex IS NOT NULL` — these are
       either manual originals OR doctor-corrected inferences.
       Cross-reference against the `sex_inference_applied` audit_log
       row to isolate the corrections.
    2. For each correction, look at first_name in
       `tools/migrate/klinika_migrate/data/sex_dictionary_albanian_kosovan.json`.
       If the dictionary disagrees with the doctor's value, update
       the dictionary entry, bump `schema_version`, document the
       change in a one-line ADR or commit message.
    3. Re-apply: future migrated patients (other clinics, or a
       redo) benefit from the corrections.
  Effort: ~30 min/quarter. Automatable later — for v1 it's a manual
  pass to keep the dictionary honest.

## Cleanup tasks
- Stale slice-XX branches (slice-01 through slice-16) can be pruned
- E2E test for receptionist edit-lock behavior on the end-of-day prompt
  (commit 8720a5c). A receptionist-only session viewing yesterday's
  incomplete visit should see the banner + "Mjeku duhet të shënojë
  statusin." label with the "Shëno status" dropdown hidden. Currently
  kalendari.spec.ts test 3 verifies the doctor's path (banner → mark →
  banner clears) under a `test.use({ authState: 'doctor' })` override;
  the receptionist-locked variant has no coverage. Effort: ~30 min.
- ~~ui: surface in_progress count across dashboard surfaces~~ —
  RESOLVED by `fix(stats): cross-view parity for "në pritje" (scheduled
  + arrived)` (2026-05-16). Doctor's DayStats tile gained the
  `X në vijim · Y në pritje` breakdown earlier the same day; the
  follow-up collapsed receptionist's `scheduled` chip into
  `scheduled + arrived` so its chip math sums to `total - cancelled`
  even when walk-ins are sitting at `arrived`. Both surfaces now use
  the same definition of "në pritje" = scheduled + arrived; granular
  calendar-filter pills remain per-status.

## v2 candidates
- DICOM MWL (auto study-patient linkage)
- AI features (clinical summary, smarter autocomplete)
- Appointment reminders (SMS or email)
- TOTP MFA option for platform admins
- Marketing landing page at klinika.health
- Self-service tenant onboarding
- Billing integration
