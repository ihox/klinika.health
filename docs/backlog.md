# Klinika Backlog

## Known deferred issues (documented in ADRs)
- See ADR 011 for visits merge follow-ups
- See ADR 008 (Middleware fix section) for soft-delete details
- See ADR 006 (DATE handling fix section) for date column patterns

## Local dev environment
- Puppeteer/Chrome fails to launch on Apple Silicon (Rosetta) — local only
- Local integration tests blocked by psql 18.3 + Prisma URL param compatibility
- TelemetryService.onApplicationBootstrap fails in @nestjs/testing harness

## Cleanup tasks
- Stale slice-XX branches (slice-01 through slice-16) can be pruned
- E2E mocks in apps/web/tests/e2e/{booking,kalendari}.spec.ts still mock the
  pre-Phase-2a `/api/appointments/*` URL space and `{appointments: [...]}`
  payload shape. Rewrite the route handlers to the new
  `/api/visits/calendar/*` paths + `{entries: [...]}` payloads + the new
  stream event names (visit.created / visit.updated / visit.status_changed
  / visit.deleted / visit.restored). doctor-home.spec.ts was already
  updated in commit 34fad6b; these two are the remaining stragglers.

## v2 candidates
- DICOM MWL (auto study-patient linkage)
- AI features (clinical summary, smarter autocomplete)
- Appointment reminders (SMS or email)
- TOTP MFA option for platform admins
- Marketing landing page at klinika.health
- Self-service tenant onboarding
- Billing integration
