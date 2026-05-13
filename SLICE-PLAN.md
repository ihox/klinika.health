# Klinika Build Slice Plan

This document defines the sequence of Claude Code build sessions for Klinika v1. Each slice is a **vertical feature** — a complete, working piece touching all layers (DB, API, UI, tests, docs).

## How to use this plan

For each slice:
1. Open a fresh Claude Code session
2. Paste the slice's full prompt (sections below)
3. Let Claude Code work end-to-end on that slice
4. Review the output, run tests, verify in the browser
5. Commit on a branch, open PR, merge to main
6. Move to the next slice

**Each slice is designed to fit in one focused 2-4 hour Claude Code session.** If a slice grows beyond that, split it.

## Slice ordering principles

- **Foundation slices first** (slices 1-3): nothing else works without these
- **Auth before features** (slice 4): every other feature depends on it
- **Receptionist before doctor**: simpler workflow, validates calendar + patient model
- **Doctor's chart late**: the most complex screen, benefits from all prior infrastructure
- **DICOM late**: requires Orthanc setup + the chart structure
- **Migration last**: requires every other model to be settled
- **Cutover after migration**: real data exercises every code path

## The 18 slices

| # | Slice | Duration | Depends on |
|---|---|---|---|
| 1 | Project skeleton + Docker dev environment | 2-3h | — |
| 2 | Database schema + RLS + Prisma setup | 3-4h | 1 |
| 3 | Health checks + telemetry agent + logging | 2h | 2 |
| 4 | Better-Auth integration + email MFA + trusted devices | 3-4h | 2, 3 |
| 5 | Platform admin /admin + tenant management | 2-3h | 4 |
| 6 | Clinic settings + working hours + payment codes config | 2-3h | 5 |
| 7 | Patient model + receptionist quick-add | 2-3h | 4 |
| 8 | Receptionist calendar + appointment CRUD | 4h | 7 |
| 9 | Appointment booking flow (both paths) + conflict detection | 3h | 8 |
| 10 | Doctor's home dashboard | 2-3h | 8 |
| 11 | Patient chart shell + visit list + master data strip | 3h | 7 |
| 12 | Visit form + auto-save + audit log per-field diffs | 4h | 11 |
| 13 | ICD-10 diagnosis picker + Terapia autocomplete | 3h | 12 |
| 14 | WHO growth charts (0-24mo) | 2-3h | 12 |
| 15 | Print pipeline (Puppeteer) + visit report + vërtetim + history | 4h | 12 |
| 16 | Orthanc integration + DICOM study picker + image viewer | 3-4h | 12 |
| 17 | Migration tool (Python, Access → Postgres) | 4h | 2 (and field decisions from 7, 11, 12) |
| 18 | Production deploy + on-premise install + DonetaMED cutover | full day | all |

Total estimated build time: ~55-65 hours of focused Claude Code work, plus testing, review, and integration time.

---

# SLICE 1 — Project skeleton + Docker dev environment

**Goal:** Bootstrap the monorepo structure, Docker Compose for local dev, and CI scaffolding. After this slice, `make dev` brings up an empty but running Next.js app, NestJS API, and Postgres.

## Prompt

```
Read CLAUDE.md, then read docs/decisions/001-repo-structure.md.

Bootstrap the Klinika project structure:

1. Create the folder layout from CLAUDE.md Section 3 (apps/web, apps/api, tools/migrate, infra/, design-reference/, docs/, .github/workflows/)
2. Initialize pnpm-workspace.yaml
3. Create apps/web/ as a minimal Next.js 15 (App Router) + TypeScript strict + Tailwind app with shadcn/ui base setup. Configure for Inter + Inter Display fonts. Empty home page that says "Klinika" centered.
4. Create apps/api/ as a minimal NestJS 10 + TypeScript strict app with one health check endpoint at GET /health that returns { status: "ok" }
5. Create infra/docker/ with Dockerfiles for web and api
6. Create infra/compose/docker-compose.dev.yml with: postgres (16), web (built from Dockerfile), api (built from Dockerfile), and orthanc (community image)
7. Configure environment variables via .env.example (DATABASE_URL, NODE_ENV, NEXT_PUBLIC_API_URL, etc.) — never commit actual .env
8. Create Makefile with targets: dev, stop, db-migrate, db-reset, lint, typecheck, test
9. Create .gitignore (node_modules, .env, .accdb, /storage/, /dist/, coverage/)
10. Create .github/workflows/ci.yml that runs on push: install, lint, typecheck, test
11. Create README.md at repo root with the project overview and quick-start

Constraints:
- All containers run with TZ=Europe/Belgrade (per ADR 006)
- Postgres runs in a Docker volume for persistence between restarts
- No PHI anywhere in this slice (no patient model yet)
- Tailwind must use design tokens from design-reference/tokens/ — link the file, don't hardcode
- After running `make dev`, the web app should be reachable at http://localhost:3000 and the api at http://localhost:3001
- The Tailwind config in apps/web/ should extend the base tokens from design-reference/tokens/tailwind.config.js

Tests:
- Add one Vitest unit test in apps/api/ that verifies GET /health returns 200
- Add one Playwright E2E test in apps/web/ that verifies the home page renders "Klinika"

Documentation:
- Update README.md with the actual quick-start commands
- Create docs/architecture.md with a placeholder ToC (we'll fill it as slices progress)

Commit on a branch named `slice-01-skeleton`. Open a PR with the slice number and goal in the title.
```

---

# SLICE 2 — Database schema + RLS + Prisma setup

**Goal:** Define the complete database schema, set up Prisma, enable Row-Level Security, and write the first migration. After this slice, the schema exists in Postgres with RLS enforced.

## Prompt

```
Read CLAUDE.md, then read docs/decisions/005-multi-tenancy.md and docs/decisions/008-soft-delete-undo.md.

Set up the Klinika database schema with Prisma:

1. Create apps/api/prisma/schema.prisma with these tables (full field lists; do not abbreviate):
   - clinics (id, subdomain, name, short_name, address, city, phones[], email, hours_config JSONB, payment_codes JSONB, logo_url, signature_url, smtp_config JSONB nullable, status enum [active, suspended], created_at, updated_at, deleted_at)
   - users (id, clinic_id FK, email unique, password_hash, role enum [doctor, receptionist, clinic_admin], first_name, last_name, title nullable, credential nullable, signature_url nullable, is_active, last_login_at nullable, created_at, updated_at, deleted_at)
   - platform_admins (id, email unique, password_hash, first_name, last_name, is_active, last_login_at nullable, created_at, updated_at)
   - patients (id, clinic_id FK, legacy_id nullable, first_name, last_name, date_of_birth DATE, place_of_birth nullable, birth_weight_g nullable, birth_head_circumference_cm nullable, birth_length_cm nullable, alergji_tjera TEXT nullable, phone nullable, created_at, updated_at, deleted_at; UNIQUE(clinic_id, legacy_id))
   - visits (id, clinic_id FK, patient_id FK, legacy_id nullable, visit_date DATE, complaint TEXT nullable, feeding_notes TEXT nullable, feeding_breast BOOL default false, feeding_formula BOOL default false, feeding_solid BOOL default false, weight_g nullable, height_cm nullable, head_circumference_cm nullable, temperature_c nullable, payment_code CHAR(1) nullable, examinations TEXT nullable, ultrasound_notes TEXT nullable, legacy_diagnosis TEXT nullable, prescription TEXT nullable, lab_results TEXT nullable, followup_notes TEXT nullable, other_notes TEXT nullable, created_by FK users, updated_by FK users, created_at, updated_at, deleted_at)
   - visit_diagnoses (id, visit_id FK, icd10_code, order_index)
   - icd10_codes (code PK, latin_description, chapter, common BOOL default false) — pre-populated with WHO ICD-10 dataset, ~14000 rows
   - prescription_lines (id, user_id FK, clinic_id FK, line_text, use_count, last_used_at, first_used_at) — per-doctor index
   - appointments (id, clinic_id FK, patient_id FK, scheduled_for TIMESTAMPTZ, duration_minutes INT, status enum [scheduled, completed, no_show, cancelled], created_by FK users, created_at, updated_at, deleted_at)
   - vertetime (id, clinic_id FK, patient_id FK, visit_id FK, issued_by FK users, issued_at TIMESTAMPTZ, absence_from DATE, absence_to DATE, diagnosis_snapshot TEXT, created_at)
   - dicom_studies (id, clinic_id FK, orthanc_study_id, received_at TIMESTAMPTZ, image_count, created_at)
   - visit_dicom_links (id, visit_id FK, dicom_study_id FK, linked_at, linked_by FK users)
   - audit_log (id, clinic_id, user_id, action, resource_type, resource_id, changes JSONB nullable, ip_address INET, user_agent, session_id, timestamp TIMESTAMPTZ default now())

2. Generate the Prisma migration: `pnpm prisma migrate dev --name initial`

3. Write a separate SQL migration file (in apps/api/prisma/migrations/manual/) that:
   - Enables Row-Level Security on every table with clinic_id
   - Creates RLS policies: `clinic_id = current_setting('app.clinic_id')::uuid` for SELECT/INSERT/UPDATE/DELETE
   - Creates the platform_admin_role Postgres role with BYPASSRLS
   - Creates indexes: (clinic_id, deleted_at) on every clinical table, (clinic_id, legacy_id) on patients and visits, (clinic_id, timestamp) and (resource_type, resource_id) on audit_log

4. Write a seed script (apps/api/prisma/seed.ts) that:
   - Inserts one clinic (DonetaMED with all real fields filled per CLAUDE.md context)
   - Inserts one platform admin (founder@klinika.health, password from env)
   - Inserts one doctor (Dr. Taulant Shala, password from env)
   - Inserts one receptionist (Erëblirë Krasniqi, password from env)
   - Loads ICD-10 codes from a fixtures CSV file at apps/api/prisma/fixtures/icd10.csv (~14k rows; create the file with the WHO ICD-10 dataset, latin descriptions only)

5. Add a Prisma middleware in apps/api/src/prisma/prisma.service.ts that:
   - Adds `WHERE deleted_at IS NULL` to all reads by default (per ADR 008)
   - Sets `app.clinic_id` from RequestContext at the start of every transaction
   - Logs slow queries (>500ms) to Pino without exposing PHI

Constraints:
- All `TIMESTAMPTZ` fields default to `now()` for created_at, and trigger-update updated_at on UPDATE
- legacy_id is nullable because new records don't have one
- Patient names migrate from Access with asterisks stripped (per ADR 010)
- No business logic in this slice — just schema and seed

Tests:
- Unit test the Prisma middleware (RLS context setting, soft-delete filter)
- Integration test: seed runs successfully, all tables have data, RLS prevents cross-clinic queries
- E2E not yet (no UI)

Documentation:
- Update docs/architecture.md with the schema overview
- Document every model in apps/api/prisma/schema.prisma with comments

Commit on branch `slice-02-schema`.
```

---

# SLICE 3 — Health checks + telemetry agent + logging

**Goal:** Production-grade observability foundation. Pino logging with PHI redaction, health checks for monitoring, telemetry agent that posts metrics to the platform.

## Prompt

```
Read CLAUDE.md sections 7 (Logging discipline) and the operational monitoring section. Read docs/decisions/002-deployment-topology.md.

Build the observability and telemetry foundation:

1. Configure Pino in apps/api/ with:
   - Structured JSON output in production
   - Pretty-print in development
   - PHI redaction paths configured: firstName, lastName, dateOfBirth, diagnosis, prescription, notes, complaint, alergji_tjera, examinations, ultrasoundNotes, labResults, followupNotes, otherNotes, email (if not in auth context)
   - Request ID generated per request (UUID v4) and propagated through all log lines
   - Standard fields on every log: timestamp, level, requestId, userId (when authenticated), clinicId (when in clinic scope)

2. Health endpoints in apps/api/:
   - GET /health — basic liveness (returns 200 if process is alive)
   - GET /health/ready — readiness (returns 200 only if DB is reachable, Prisma can query)
   - GET /health/deep — deep health (DB latency, pg-boss state, Orthanc reachable, disk usage; not exposed publicly, used by telemetry)

3. Build the telemetry agent as a NestJS module in apps/api/src/modules/telemetry/:
   - Runs every 60 seconds via pg-boss scheduled job
   - Collects: app/DB/Orthanc health, CPU usage, RAM usage, disk usage per volume, last successful backup time, active session count, queue depth, error rate (5xx/min)
   - All metadata only — no PHI
   - POSTs to https://klinika.health/api/telemetry/heartbeat (configurable)
   - On cloud-hosted installs, the platform tenant receives its own heartbeats
   - On on-premise installs, the heartbeat goes to the platform server
   - Includes tenant identifier and version string

4. Platform-side heartbeat receiver in apps/api/:
   - POST /api/telemetry/heartbeat (authenticated via shared secret per tenant)
   - Stores in `telemetry_heartbeats` table with retention of 90 days
   - Triggers alert logic on critical events (tenant offline >5min, disk >95%, backup failed twice)

5. Alert logic:
   - Critical: immediate email to platform admin (and SMS hook for v1.5)
   - Warning: appended to daily digest table for the 9am summary email
   - Smart grouping: if multiple tenants offline simultaneously, single notification with the pattern

6. Frontend: small connection status indicator in apps/web/ that ping /health/ready every 30s and shows online/offline state in the corner.

Constraints:
- No PHI in telemetry payloads (verified by tests)
- Heartbeats failing don't crash the app (logged but not fatal)
- Telemetry runs even when the API is degraded (separate pg-boss job)

Tests:
- Unit: PHI redaction works for all listed fields
- Unit: heartbeat payload contains no PHI
- Integration: heartbeat post to platform inserts a row in telemetry_heartbeats
- Integration: alert logic triggers on simulated critical events
- E2E: connection status indicator updates correctly on simulated network drop

Documentation:
- Add docs/runbook.md with sections: "Tenant offline alert procedure", "Backup failure procedure", "Disk full procedure"
- Document the telemetry agent in docs/architecture.md

Commit on branch `slice-03-observability`.
```

---

# SLICE 4 — Better-Auth integration + email MFA + trusted devices

**Goal:** Complete authentication flow with email/password, email MFA on new devices, trusted device cookies, password reset, and audit logging on auth events.

## Prompt

```
Read CLAUDE.md sections 1, 5.1 (API endpoints), and 7 (Logging). Read docs/decisions/004-authentication.md and docs/decisions/005-multi-tenancy.md.

Build the complete authentication system using Better-Auth:

1. Install and configure Better-Auth in apps/api/:
   - Email + password (Argon2 hashing)
   - Two-factor plugin configured for email codes
   - Sessions in Postgres (auth_sessions table managed by Better-Auth)
   - Trusted devices via the trusted-device plugin (30-day cookie)
   - Email integration via Resend (configurable per clinic SMTP later — for now Resend is enough)

2. Login flow at apps/web/login:
   - Email + password form
   - "Më mbaj të kyçur" checkbox (extends session to 30 days)
   - "Harruat fjalëkalimin?" link
   - On submit: call /api/auth/login
   - If MFA required (new device): redirect to /verify
   - If trusted device: log in immediately

3. MFA verification page at apps/web/verify:
   - 6-digit code input with auto-advance between digits
   - Email masked with middle dots
   - "Mos pyet përsëri në këtë pajisje" checkbox (checked by default)
   - "Dërgoje përsëri" with 30-second cooldown
   - On wrong code: amber error state
   - After 3 wrong: redirect back to login with "Tepër përpjekje"
   - On success with checkbox: trusted device cookie set, redirect to role-appropriate home
   - All copy in Albanian per CLAUDE.md design reference

4. Email templates (Albanian, minimal HTML):
   - MFA code email
   - New-device-trusted alert email
   - Password reset email
   - Templates in apps/api/src/modules/email/templates/

5. Password reset flow:
   - "Harruat fjalëkalimin?" page collects email
   - Sends reset link via Resend
   - Reset link → reset page → new password form (strength indicator, haveibeenpwned check)
   - On success: redirect to login

6. Password requirements:
   - Min 10 chars
   - Haveibeenpwned check (k-anonymity API)
   - No complexity rules
   - Strength indicator: weak / medium / strong / very strong

7. Profile page at apps/web/profili-im:
   - Read-only identity card (name, email, role, clinic, dates)
   - Password change form (current + new + confirm)
   - "Dilni nga të gjitha sesionet e tjera" button
   - Trusted devices list with per-device "Hiq besimin" button
   - Helper text: "Për të ndryshuar emrin, email-in ose nënshkrimin tuaj, kontaktoni administratorin e klinikës."

8. Logout flow:
   - Logout button → session revoked → redirect to login
   - "Logout other sessions" → all sessions for this user except current revoked

9. Audit log integration:
   - auth.login.success / auth.login.failed
   - auth.mfa.sent / auth.mfa.verified / auth.mfa.expired
   - auth.device.trusted / auth.device.revoked
   - auth.password.changed
   - auth.sessions.revoked
   - auth.logout

10. Rate limiting (per CLAUDE.md Section 9):
    - POST /auth/login: 5/min per IP, 10/hour per email
    - POST /auth/mfa/send: 3/min per email
    - POST /auth/mfa/verify: 5/min per session
    - Backed by Postgres (rate_limits table)

11. ClinicScopeGuard middleware:
    - Extracts subdomain from Host header
    - Resolves to clinic_id
    - Sets request.clinicId
    - Sets Postgres `app.clinic_id` for RLS
    - For /admin routes (platform admin), bypasses clinic scope

Constraints:
- All UI strings in Albanian
- Email MFA fires on first login from any device that lacks the trusted cookie
- Better-Auth version pinned in package.json
- Auth endpoints under /api/auth/* per Better-Auth conventions

Tests:
- Unit: Argon2 hashing, password strength, MFA code generation/verification
- Integration: full login + MFA flow, trusted device flow, password reset
- Integration: rate limiting kicks in on excessive requests
- Integration: multi-tenant isolation (user from clinic A can't log into clinic B's subdomain)
- E2E: complete login + MFA → land on doctor's home
- E2E: complete login on second login from same device → no MFA prompt
- E2E: password reset full flow

Documentation:
- Add docs/architecture.md section on the auth flow
- Update CLAUDE.md if any pattern emerged that should be a hard rule

Commit on branch `slice-04-auth`.
```

---

# SLICE 5 — Platform admin /admin + tenant management

**Goal:** Platform admin can create clinics (tenants), suspend/unsuspend, view operational health, and bootstrap clinic admin users.

## Prompt

```
Read CLAUDE.md and ADR 002 (deployment topology) and ADR 005 (multi-tenancy).

Build the platform admin area at /admin:

1. Routes:
   - GET /admin — tenants list (table with name, subdomain, status, last activity)
   - GET /admin/tenants/new — create tenant form
   - POST /admin/tenants — create tenant
   - GET /admin/tenants/:id — tenant detail (operational health, settings, user count)
   - POST /admin/tenants/:id/suspend — suspend tenant
   - POST /admin/tenants/:id/activate — activate tenant
   - GET /admin/platform-admins — list platform admins
   - POST /admin/platform-admins — create platform admin
   - GET /admin/health — platform health dashboard rollup

2. Create tenant flow:
   - Name, short name
   - Subdomain (validated: lowercase a-z 0-9 hyphens only, unique, reserved words blocked: admin, www, api, mail, support)
   - Contact info (city, phones, email)
   - Initial clinic admin email + name
   - On submit:
     - Create clinic row
     - Create initial clinic_admin user with a generated random password
     - Send setup email to admin with login link + temporary password
     - Optionally auto-provision DNS (out of scope for now — manual DNS step documented)
   - Subdomain availability check while typing

3. Tenant detail page sections:
   - Identity (name, subdomain, contact)
   - Status (Aktive/Pezullim toggle with confirmation)
   - Users (count, last login times)
   - Operational health (from telemetry agent, per ADR 002 monitoring section): live status, app/DB/Orthanc health, disk usage with progress bars, backup status, system metrics
   - Activity (last 30 days of audit log entries, filtered to admin-relevant actions)

4. Platform health dashboard at /admin/health:
   - Rollup of all tenant statuses
   - Issues panel (recent alerts, unresolved)
   - Charts: tenant count over time, total active users, error rates
   - Updates every 60s via TanStack Query polling

5. Suspended tenant behavior:
   - Suspended clinic's users see a login-blocked page: "Klinika juaj është pezulluar. Kontaktoni adminin."
   - API returns 403 for any request to a suspended clinic's subdomain
   - Active tenant's audit log records the suspension event

6. Security:
   - All /admin routes require platform_admin role
   - Cloudflare Access in production gates the /admin path (configured at deploy time, not in code)
   - Platform admin MFA required (uses same Better-Auth email MFA flow but with platform_admins table)

Constraints:
- Platform admins live in platform_admins table (no clinic_id, see ADR 005)
- Creating a clinic does NOT auto-provision DNS — that's a manual step in deployment.md
- Suspended tenants' data is preserved, not deleted

Tests:
- Unit: subdomain validation (allowed chars, reserved words)
- Integration: create tenant, suspend, activate, audit log entries
- Integration: suspended tenant's user cannot log in
- E2E: full create-tenant flow from /admin/tenants/new to seeing the new tenant in the list
- E2E: suspend/activate cycle

Documentation:
- Add docs/deployment.md section: "Provisioning a new tenant"
- Document the platform_admins table separation in architecture.md

Commit on branch `slice-05-admin`.
```

---

# SLICE 6 — Clinic settings + working hours + payment codes config

**Goal:** Clinic admin can configure their clinic — info, logo upload, signature upload, working hours per day, payment codes, email (Resend default vs SMTP override), user management.

## Prompt

```
Read CLAUDE.md and design-reference/prototype/clinic-settings.html.

Build the clinic admin settings area:

1. Routes (clinic-scoped via subdomain, requires clinic_admin role):
   - GET /cilesimet — settings home (tabs: Përgjithshme, Përdoruesit, Pagesa, Orari, Email, Auditimi)
   - PUT /api/clinic/settings — update various settings sub-sections

2. "Përgjithshme" (General) tab:
   - Name, short name, address, city
   - Phones (multi-input, can add/remove)
   - Email (clinic-level contact email)
   - Logo upload (PNG/SVG, stored in /storage/<clinic_id>/logo.{png,svg}, served via /api/clinic/logo)
   - Signature upload (PNG with transparent background) — encrypted at rest in /storage/<clinic_id>/signature.png
   - **Note shown prominently:** "Vula fizike e klinikës duhet të vendoset manualisht në çdo dokument të printuar. Vulat digjitale nuk janë të lejuara në Kosovë."

3. "Përdoruesit" (Users) tab:
   - Table of clinic users: name, email, role, status, last login
   - [Shto përdorues] button → modal with email, name, role
   - [Edit] per user → email, name, role, signature upload (doctors only)
   - [Çaktivizo] per user → confirmation, sets is_active=false
   - [Reset fjalëkalimin] per user → generates reset email to user's address
   - Cannot delete users (audit log integrity)

4. "Pagesa" (Payment codes) tab:
   - Editable table: code, label, amount in €
   - Default DonetaMED values: E=0 Falas, A=15, B=10, C=5, D=20
   - Stored as JSONB in clinics.payment_codes
   - Codes are stable identifiers; only labels and amounts editable
   - Adding new codes possible but rare (F, G, etc.)

5. "Orari dhe terminet" (Working hours) tab:
   - Each day of week: Hapur/Mbyllur toggle, single time range (no split hours per locked decision)
   - "Apliko orarin e së hënës për të gjitha ditët" convenience button
   - Default: Mon-Sat open 10:00-18:00, Sunday closed (per CLAUDE.md DonetaMED context)
   - Appointment durations: multi-select checkboxes (10, 15, 20, 30, 45, 60 min, + custom input)
   - Default duration: dropdown picking from selected durations
   - Stored as JSONB in clinics.hours_config:
     ```json
     {
       "days": {
         "mon": { "open": true, "start": "10:00", "end": "18:00" },
         "sun": { "open": false }
       },
       "durations": [10, 15, 20, 30, 45],
       "default_duration": 15
     }
     ```

6. "Email" tab:
   - Radio: Use Resend (platform default) / Use custom SMTP
   - If custom SMTP: host, port, username, password (encrypted at rest), from address, "Test" button
   - Test sends a test email and reports success/failure
   - On SMTP failure during runtime: app auto-falls back to Resend with audit log entry

7. "Auditimi" (Audit log) tab:
   - Filterable table: date range, user, action type, resource type
   - Expand row to see field-level diffs in the changes JSONB
   - Export to CSV button
   - Read-only (no edits/deletes)

8. File upload security:
   - Logo: max 2MB, PNG/SVG only, no script tags in SVG (sanitize)
   - Signature: max 1MB, PNG only, transparent background recommended
   - Both stored outside web-accessible paths; served via authenticated proxy endpoint

Constraints:
- Settings save uses optimistic UI: change fields, save with debounced auto-save where possible
- All UI in Albanian per design reference
- Use the HTML prototype as canonical layout reference

Tests:
- Unit: working hours JSON validation
- Unit: payment codes JSON validation
- Unit: SVG sanitization on logo upload
- Integration: SMTP test endpoint
- Integration: signature encryption at rest
- E2E: full settings flow, edit each section, verify saved values

Documentation:
- Add docs/runbook.md section: "Setting up a new clinic"

Commit on branch `slice-06-clinic-settings`.
```

---

# SLICE 7 — Patient model + receptionist quick-add

**Goal:** Patient CRUD with strict role-based visibility. Receptionist can quick-add (name + DOB). Doctor sees full master data.

## Prompt

```
Read CLAUDE.md sections on the receptionist's privacy boundary. Read design-reference/prototype/ for patient-related screens.

Build the patient model with role-scoped visibility:

1. API endpoints (all clinic-scoped, RLS enforced):
   - GET /api/patients?q=<query>&limit=10 — search (returns id, first_name, last_name, date_of_birth ONLY for receptionist; full record for doctor)
   - POST /api/patients — create (receptionist or doctor)
     - Receptionist body: { firstName, lastName, dateOfBirth? }
     - Doctor body: full master data
   - GET /api/patients/:id — get full record (DOCTOR ONLY)
   - PATCH /api/patients/:id — update (DOCTOR ONLY)
   - DELETE /api/patients/:id — soft delete (DOCTOR ONLY)

2. Search behavior:
   - Fuzzy matching using Postgres trigram extension (pg_trgm)
   - Diacritic-insensitive (using unaccent extension)
   - Matches on first_name, last_name, date_of_birth, legacy_id
   - Combined search: "Hoxha 2024" matches surname Hoxha + DOB year 2024
   - Returns max 10 results, sorted by relevance
   - **Receptionist response only includes**: id, firstName, lastName, dateOfBirth — no other fields, ever

3. Quick-add UI (receptionist):
   - Modal with three fields: Emri, Mbiemri, Datelindja (optional)
   - Helper text: "Mjeku do t'i plotësojë të dhënat e tjera në vizitën e parë."
   - On submit: POST /api/patients, patient created with minimal data
   - Returns the new patient for immediate booking

4. Soft duplicate notice (informational only, never blocking, per locked decision):
   - As receptionist types in the quick-add fields, the system checks for likely duplicates
   - If found (similar name + similar DOB), shows a soft info notice:
     "Mund të ekzistojë tashmë: Rita Hoxha · 12.02.2024, Rita Hoxhaj · 15.02.2024"
   - Two buttons: [Përdor pacientin ekzistues] (selects the existing patient for the booking) or [Vazhdo si i ri] (creates new anyway)
   - NEVER blocks creation

5. Full patient form (doctor):
   - All master data fields (per CLAUDE.md schema)
   - Alergji / Tjera shows with ⚠ icon and warning styling (internal only — not printed)
   - Stored on the patient record
   - Auto-save with debounce + safety net per CLAUDE.md Section 5.4

6. Master data strip (read by patient chart, will be used in slice 11):
   - Compact horizontal strip with: ID · Name · Sex (derived/manual) · Age (auto from DOB) · Vendi · Phone
   - Below: Lindja · birth weight · length · head circumference
   - Color indicator chip (green/yellow/red based on last visit, doctor only)
   - ⚠ Alergji / Tjera (if present, doctor only, NEVER on receptionist's view)

7. RLS enforcement:
   - Receptionist's role triggers a column-level filter at the API layer
   - Even if a bug surfaces full data in the response, RLS doesn't help here (it's same table) — API serialization is the gatekeeper
   - Tests verify receptionist NEVER sees forbidden fields, even with crafted queries

Constraints:
- Receptionist's API responses use a separate DTO type (PatientPublicDto) that has only id, firstName, lastName, dateOfBirth
- Doctor's API responses use full PatientFullDto
- These DTOs are enforced by class-transformer / Zod schemas on response serialization
- Search performance: index on (clinic_id, deleted_at) and trigram indexes on first_name and last_name

Tests:
- Unit: PatientPublicDto serialization excludes forbidden fields even when given full input
- Unit: fuzzy search matching (Hoxa → Hoxha, diacritic handling)
- Integration: receptionist GET /api/patients returns only public fields
- Integration: receptionist GET /api/patients/:id returns 403
- Integration: receptionist POST /api/patients with extra fields (address, phone) — fields silently dropped, not stored
- Integration: doctor sees full data
- E2E: receptionist search + quick-add flow
- E2E: receptionist duplicate notice flow (both paths)
- E2E: doctor full patient creation/edit
- E2E: receptionist cannot access the doctor's full patient page (URL navigation blocked)

Documentation:
- Document the role-scoped DTO pattern in CLAUDE.md or docs/architecture.md

Commit on branch `slice-07-patients`.
```

---

# SLICE 8 — Receptionist calendar + appointment CRUD

**Goal:** Day-column calendar view, today + next 5 open days, appointment cards with name+DOB, status indicators, stats panel.

## Prompt

```
Read CLAUDE.md and design-reference/prototype/receptionist.html.

Build the receptionist's calendar:

1. Calendar layout (matching the design prototype exactly):
   - Top: greeting + date subtitle
   - Stats panel (two cards): "Sot" (today's totals) + "Termini i ardhshëm" (next appointment with countdown)
   - Calendar: day-column view, today + next 5 OPEN days (skipping days marked Mbyllur in clinic config)
   - Each column: time axis 10:00-18:00 (or clinic's configured hours), 10-minute grid
   - "Now" line: thin teal horizontal showing current time on today's column, updates every minute
   - Appointment cards in their time slots with: name, DOB, duration, color indicator chip

2. Color indicator chip (green/yellow/red):
   - Green: last visit >30 days ago
   - Yellow: last visit 7-30 days ago
   - Red: last visit 1-7 days ago
   - No indicator if no prior visits
   - Calculated on the fly, cached briefly per patient

3. Appointment status visual treatment:
   - scheduled: solid teal card
   - completed: soft green check icon, muted color
   - no_show: soft red outline, "MS" indicator, greyed
   - cancelled: strikethrough, very muted

4. API endpoints:
   - GET /api/appointments?from=DATE&to=DATE — list for date range
   - POST /api/appointments — create (validates: no conflicts, within working hours)
   - PATCH /api/appointments/:id — update status, time, duration
   - DELETE /api/appointments/:id — soft delete with 30s undo

5. Stats panel data:
   - GET /api/appointments/stats?date=DATE — returns today's stats
   - Live polling every 30s for currentness

6. Empty/no-show prompts:
   - End-of-day check at clinic close time: any appointments still in 'scheduled' status get a soft prompt next morning at the top of the calendar: "3 termine të djeshme janë pa status. Shëno tani?"
   - Click each → quick status menu (Kryer / Mungoi / Anulluar)
   - Never auto-mark anything

7. Calendar interactivity:
   - Tapping an empty slot opens the patient search dropdown (booking flow continues in slice 9)
   - Tapping an existing appointment opens the appointment detail panel (status menu, edit, delete)
   - Right-click (or long-press on tablet) → context menu: Shëno si kryer, Shëno si mungoi, Anulo, Fshi

8. Receptionist sees appointment cards with name + DOB only. No clinical data anywhere on the calendar.

9. Real-time updates:
   - WebSocket or Server-Sent Events: when the doctor saves a visit, the linked appointment status updates to 'completed' on the receptionist's screen without refresh
   - Alternative if WebSockets are complex: TanStack Query polling every 30s

Constraints:
- The 10-minute grid is the base unit (matches the smallest possible duration)
- Working hours come from clinic config (hours_config JSONB)
- Sundays skipped by default; clinic admin can configure other closed days
- All UI in Albanian per the design prototype

Tests:
- Unit: color indicator calculation (date math edge cases)
- Unit: conflict detection (overlapping appointments)
- Unit: working hours respect (cannot book outside clinic hours)
- Integration: appointment CRUD with audit log
- E2E: full booking flow (slot tap → patient search → booking dialog covered in slice 9)
- E2E: status changes update visually
- E2E: end-of-day prompt appears for yesterday's unmarked appointments

Documentation:
- Document the appointment lifecycle in docs/architecture.md

Commit on branch `slice-08-calendar`.
```

---

# SLICE 9 — Appointment booking flow (both paths) + conflict detection

**Goal:** Complete booking flows — slot-first (calendar) and patient-first (search). Conflict detection with auto-extend confirmation.

## Prompt

```
Read CLAUDE.md and design-reference/prototype/Booking dialog states.html and Booking flow paths.html.

Build both booking flows:

1. Slot-first booking (Path 1):
   - Receptionist taps an empty time slot on the calendar
   - Patient search dropdown opens, cursor focused
   - She types or picks an existing patient (or quick-adds a new one)
   - Booking dialog opens with date+time pre-filled from the tapped slot
   - She picks duration (10, 15, 20, 30, 45, 60 min — based on clinic config)
   - [Cakto termin] disabled until both time and duration valid
   - On confirm: appointment created, toast confirmation

2. Patient-first booking (Path 2):
   - Receptionist uses the global search field at the top
   - Picks an existing patient or quick-adds a new one
   - Booking dialog opens with today's date pre-filled, time empty
   - She manually picks time
   - Rest of flow identical

3. Booking dialog (matches design prototype exactly):
   - Title: "Cakto termin"
   - Patient row: name · DOB (read-only)
   - Date picker (defaults from slot or today)
   - Time picker (10-minute increments within clinic hours)
   - Duration selector: segmented control or large radio buttons with all configured durations
   - NO default duration pre-selected — must explicitly tap one
   - [Anulo] [Cakto termin] buttons

4. Conflict detection:
   - On duration selection, check if the slot accommodates the chosen duration
   - **Case A (fits):** "Cakto termin" enables, no warnings
   - **Case B (next slot is free, can auto-extend):** show inline notice "Ky termin do të zgjasë deri HH:MM. Të vazhdojmë?" in calm styling
   - **Case C (next slot is booked, cannot accommodate):** disable the conflicting duration option(s) with inline warning "Kjo kohëzgjatje nuk është e disponueshme në këtë orar."

5. New-patient flow within booking:
   - If no existing patient matches the search, the receptionist sees "+ Shto pacient të ri" at the bottom of the dropdown
   - Clicking it opens the quick-add modal (slice 7)
   - On successful add, the dialog returns to the booking dialog with the new patient pre-selected

6. Confirmation toast:
   - "Termini u caktua për DD maj, ora HH:MM (X min)"
   - Auto-dismisses after 4 seconds
   - Has an "Anulo" inline if the receptionist made a mistake — clicking soft-deletes the appointment (within 30s window per ADR 008)

7. Edit existing appointment:
   - Tapping an existing appointment card opens an edit modal
   - Can change time, duration, status
   - Cannot change patient (would create confusion — delete + create new instead)
   - Edit goes through the same conflict detection

Constraints:
- Both paths must converge on the same booking dialog (single source of truth)
- The dialog's behavior is identical regardless of path
- All UI strings match the design prototype exactly

Tests:
- Unit: conflict detection logic with various scenarios
- Unit: auto-extend boundary cases
- Integration: full booking via Path 1
- Integration: full booking via Path 2
- E2E: slot-first → patient search → quick-add → booking → confirmation
- E2E: patient-first → search → booking → confirmation
- E2E: conflict scenarios — fit, auto-extend, fully conflicted
- E2E: edit existing appointment

Documentation:
- Update docs/architecture.md with the booking flow diagram

Commit on branch `slice-09-booking`.
```

---

# SLICE 10 — Doctor's home dashboard ("Pamja e ditës")

**Goal:** The dense, single-screen doctor's home with today's appointments, stats, next patient panel, completed visits.

## Prompt

```
Read CLAUDE.md and design-reference/prototype/doctor.html.

Build the doctor's home dashboard:

1. Routes:
   - GET / (when authenticated as doctor) — Pamja e ditës

2. Layout (matches design prototype):
   - Top: greeting (time-of-day-aware: Mirëmëngjes/Mirëdita/Mirëmbrëma/Natë e mbarë) + date subtitle
   - Two-column main area:
     - Left: today's appointments + day stats + quick search
     - Right: next patient panel + completed visits

3. Today's appointments column:
   - Full list with times and patient names
   - Current/next highlighted with teal border
   - Click any appointment → jump to that patient's chart
   - Auto-refresh every 60s

4. Day stats card (compact, scannable):
   - Visits: 5 / 10 (completed / total)
   - Mesatare: 12 min/vizitë
   - Pagesa: € 95 (today's total based on payment codes)
   - Optional: visit time distribution

5. Quick search:
   - Small search field
   - Reuses the patient search from slice 7
   - Focus shortcut: `/` or `⌘/Ctrl+K`

6. Next patient panel:
   - Patient name, age, sex
   - Days since last visit (with color indicator)
   - Last diagnosis
   - Last weight
   - **Alergji / Tjera with ⚠ icon if present** (doctor-only visibility)
   - [Hap kartelën] button → goes to patient chart

7. Completed visits log:
   - Today's completed visits
   - Time · patient name · diagnosis (short) · payment code
   - Click any → jump to that visit
   - Sorted oldest-first (chronological today)

8. Real-time freshness:
   - Polling every 60s on the appointments list
   - WebSocket or SSE for status changes if implemented in slice 8
   - "Now" indicator if a current visit is in progress

Constraints:
- Single-screen, no scrolling on 1440×900 desktop
- Click-through from anything visible to its detail
- All UI in Albanian per design prototype
- Time-of-day greeting respects Europe/Belgrade per ADR 006

Tests:
- Unit: time-of-day greeting selection
- Unit: day stats aggregation
- Integration: dashboard loads with seeded data
- E2E: complete day workflow — login → home → click appointment → see chart → return home → next appointment

Documentation:
- Document the dashboard's data model in docs/architecture.md

Commit on branch `slice-10-doctor-home`.
```

---

# SLICE 11 — Patient chart shell + visit list + master data strip

**Goal:** The patient chart's structure: master data strip on top, two-column layout below, visit list in left column, growth charts placeholder + ultrasound placeholder + vërtetim history in right column.

## Prompt

```
Read CLAUDE.md and design-reference/prototype/chart.html.

Build the patient chart shell:

1. Routes:
   - GET /pacient/:id — patient chart (doctor only)

2. Master data strip (full width, top, ~80px tall, always visible):
   - ID · Name · Sex · Age (auto from DOB, formatted "2v 3m") · Vendi · Phone
   - Lindja: date · birth weight · length · head circumference
   - Color indicator chip
   - ⚠ Alergji / Tjera (with full text on hover, doctor-only)
   - All fields display tabular numerals

3. Below master data: two-column layout (left ~60%, right ~40% on desktop)

4. Left column: visit form area (filled in slice 12)
   - For now, placeholder showing visit number indicator "Vizita 4 nga 12"
   - Visit navigation: ◀ Paraprake / Ardhshme ▶ buttons
   - Visit date dropdown for direct jump
   - Action bar sticky at bottom (Fshij/Vizitë e re/Printo/Vërtetim/Histori — wire up in later slices)

5. Right column: clinical context panels (stubs for now, filled in later slices):
   - "Diagramet e rritjes" — placeholder card, will be filled in slice 14
   - "Ultrazeri" — placeholder card, will be filled in slice 16
   - "Historia" — compact visit history list (read-only, jump-to)
   - "Vërtetime" — list of issued vërtetime (display + reprint), per the simplified spec

6. Visit history compact list:
   - Show 10 most recent visits
   - Per row: date · diagnosis short · payment code chip
   - Click → load that visit into the left column
   - "Shfaq më shumë" expands to show all

7. Vërtetime list:
   - Per row: issue date · absence range · duration · diagnosis snapshot
   - Two icon actions: 👁 view (opens print preview) and 🖨 reprint
   - Empty state: "Asnjë vërtetim i lëshuar për këtë pacient."

8. URL structure:
   - /pacient/:id — defaults to most recent visit
   - /pacient/:id/vizita/:visit_id — specific visit
   - History dropdown updates URL on navigation

9. Visit navigation:
   - ◀ / ▶ buttons disabled when at boundaries
   - Keyboard shortcuts: ← / → arrow keys (only when not focused in a form field)
   - "Vizita 4 nga 12" indicator

10. Loading and empty states:
    - Loading: skeleton for master data strip and visit area
    - No visits yet: "Asnjë vizitë e regjistruar. Shtoni të parën." with [Vizitë e re] button

Constraints:
- Master data strip stays visible on scroll (sticky)
- Action bar sticky at bottom of left column
- Receptionist accessing /pacient/:id gets 403

Tests:
- Unit: age formatting (2v 3m, 11m, 1v, edge cases)
- Unit: color indicator on master data strip
- Integration: GET /api/patients/:id returns full patient with related visits and vërtetime
- E2E: open patient chart, navigate visits with ← →, see history list, click old visit, see master data

Documentation:
- Document the patient chart data flow in docs/architecture.md

Commit on branch `slice-11-chart-shell`.
```

---

# SLICE 12 — Visit form + auto-save + audit log per-field diffs

**Goal:** The doctor's primary work surface — the visit form with all clinical fields, auto-save with safety net, audit log writes with per-field diffs (JSONB array), edit history modal.

## Prompt

```
Read CLAUDE.md sections 5.3 (audit log), 5.4 (auto-save), and design-reference/prototype/chart.html. Read ADR-008 (soft delete).

Build the visit form:

1. Visit form fields (in this clinical order, per the design prototype):
   - Data e vizitës (auto-set, with "Nga vizita paraprake: N ditë" diff display)
   - Ankesa (textarea, free text)
   - Ushqimi: 3 checkboxes — Gji / Formulë / Solid (and a free-text note field)
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

2. Auto-save (the safety net per CLAUDE.md Section 5.4):
   - Triggers: 1.5s debounce on input, field blur, navigation, button save, 30s idle, beforeunload
   - State indicator visible: Idle / Dirty / Saving / Saved / Error
   - State machine implemented as React state + Zustand store
   - PATCH /api/visits/:id with only the changed fields (delta save)
   - On failure: show dialog listing unsaved fields, retry option, "save to local" backup
   - Local IndexedDB backup of dirty state (cleared on successful save)
   - Page title gets * prefix when dirty

3. Save state indicator UI:
   - Compact pill in the visit header
   - Idle: empty
   - Dirty: "● Ndryshime të paruajtura" gentle warning color
   - Saving: spinner + "Duke ruajtur..."
   - Saved: ✓ "U ruajt 2 sek më parë" (with relative time, updates every 10s)
   - Error: ⚠ "Ruajtja dështoi. Provoni përsëri." + retry button

4. Audit log writes (per ADR 005-008, JSONB changes array):
   - On every save event, compute diff between pre-save and post-save state
   - Write one audit row per save event:
     ```json
     {
       "action": "visit.updated",
       "resourceType": "visit",
       "resourceId": visit.id,
       "changes": [
         { "field": "diagnosis", "old": "...", "new": "..." },
         { "field": "prescription", "old": "...", "new": "..." }
       ]
     }
     ```
   - **Coalescing rule:** if the same user saves the same visit again within 60 seconds, the existing audit row is UPDATED (combining the changes), not a new row inserted
   - Coalesce logic: SELECT FOR UPDATE the most recent audit row matching (resource_type, resource_id, user_id) within last 60s, merge the changes JSONB, update the timestamp

5. "Modifikuar nga..." inline indicator on edited visits:
   - Only shown if the visit has been updated AFTER initial creation
   - Format: "Modifikuar nga Dr. Taulant më 14.05.2026 13:47"
   - Subtle styling — small, muted color
   - Clickable: opens the change history modal

6. Change history modal:
   - Title: "Historia e ndryshimeve · Vizita e [date]"
   - List of audit log events for this visit, newest first
   - Each event: "Dr. Taulant · 14.05.2026 13:47" header, then field-by-field "Më parë: X" / "Tani: Y"
   - First event: "Krijuar (vizita e re)" with no diffs
   - Long values truncate with "Shfaq plotësisht" expansion
   - Close: X button or Esc
   - Read-only (no restore/rollback in v1)

7. Delete visit:
   - Action bar [Fshij vizitën] button
   - No confirmation modal (Gmail pattern)
   - Soft delete: sets visit.deleted_at = now()
   - Toast: "Vizita u fshi. [Anulo]" with 30s countdown
   - Click "Anulo" within 30s: restore (deleted_at = null)
   - After 30s: toast dismisses, visit stays soft-deleted

8. Vizitë e re (new visit) button:
   - Creates a new visit record for the current patient
   - Pre-fills today's date
   - Other fields empty
   - Auto-save kicks in as soon as something is typed

Constraints:
- Auto-save MUST never lose work
- Audit log writes are transactional with the visit update (same DB transaction)
- Coalescing prevents audit log spam from auto-save
- Form validation prevents save with critical errors (e.g. negative weight) but allows save with empty fields (most fields are optional)
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

**Goal:** The two specialized inputs that define the doctor's workflow — multi-select ICD-10 with frequently-used codes float, and the personal prescription history autocomplete.

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
   - **No Albanian translations in v1** — Latin only
   - No suggestions banner, no "you might also consider" — pure search
   - Selected diagnoses appear as chips above the search field
   - Each chip has × to remove
   - Order matters: first chip = primary diagnosis
   - Drag-to-reorder via dnd-kit
   - Keyboard: arrows to navigate dropdown, Enter to add, Tab to commit, Backspace removes last chip

2. Frequently-used tracking:
   - Each time a visit is saved with diagnoses, increment use counts in a `doctor_diagnosis_usage` table (doctor_id, icd10_code, use_count, last_used_at)
   - Per-doctor (not per-clinic) — different doctors see different frequent-used lists

3. Terapia autocomplete:
   - Multi-line textarea, monospace-ish font for medical shorthand
   - As doctor types each line (2+ chars), floating suggestions appear below cursor
   - Backend: GET /api/prescriptions/suggest?q=<line>&doctorId=<id>
   - Suggestions sourced from `prescription_lines` table (per-doctor index)
   - Display: prescription text + use count chip ("12 uses")
   - Keyboard: ↓ to navigate, Tab or Enter to accept, Esc dismisses
   - Right-click suggestion → "Harro këtë sugjerim" (deletes the prescription_lines row)
   - When a visit is saved with prescription text, parse line-by-line, upsert each line in prescription_lines (increment use_count if exists, create if new)

4. Snippet picker (`⌘/Ctrl + ;`):
   - Opens modal with doctor's top 20 prescription patterns
   - Tap to insert at cursor
   - Each snippet shows: text + last used + use count

5. Prescription seeding from migration:
   - When the Access migration runs (slice 17), pre-populate prescription_lines from historical Terapia values
   - Each unique line becomes a row, use_count = number of times it appeared
   - On day-one of using Klinika, autocomplete already knows the doctor's patterns

Constraints:
- Diagnosis dropdown: max 20 results visible, virtualized if longer
- Diagnosis search: handles ICD-10 chapters (J = respiratory, etc.) — typing "J" returns common J codes
- Prescription suggestions: max 6 visible, sorted by frequency-recency blend
- "Forget suggestion" requires confirmation (small inline confirmation, not a modal)
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

**Goal:** The WHO growth charts in the patient chart's right column — weight, height, head circumference, P3/P15/P50/P85/P97 percentiles, hidden for patients >24 months (with optional historical view link).

## Prompt

```
Read CLAUDE.md and design-reference/prototype/chart.html (Diagramet e rritjes section).

Build the WHO growth charts:

1. Data source:
   - Pre-load WHO Child Growth Standards data as static JSON fixtures in apps/web/lib/who-growth-data/
   - Three datasets: weight-for-age, length/height-for-age, head-circumference-for-age
   - Split by sex (boys / girls)
   - Age in months (0-24)
   - Percentile curves: P3, P15, P50, P85, P97
   - Source: WHO Child Growth Standards (publicly available CSVs)

2. Chart components (using Recharts):
   - Three compact sparkline cards on the patient chart right column:
     - "Pesha sipas moshës" — weight chart
     - "Gjatësia sipas moshës" — length chart
     - "Perimetri i kokës" — head circumference chart
   - Each shows:
     - WHO percentile bands as soft gradient zones
     - Patient's data points as dots connected by a line
     - X-axis: months (0-24)
     - Y-axis: values with units
     - Tabular numerals everywhere
   - Click any sparkline → full-size modal

3. Full-size modal:
   - Larger chart, more detail
   - Three tabs: Pesha / Gjatësia / Perimetri kokës
   - Tooltip on hover: "Data: DD.MM.YYYY · Vlera: X · Mosha: N muaj"
   - Print this chart button (separate from main visit report)
   - Optional BMI chart for older children (>2 years) — but only if BMI is meaningful

4. Age cutoff at 24 months:
   - For patients ≤24 months: charts visible in the right column
   - For patients >24 months: charts hidden (the panel collapses)
   - Replacement: small "Shiko grafikët historikë" link IF the patient has historical 0-24mo data
   - Click the link → modal with historical charts using the same components, "Historiku 0-24 muaj" title

5. Sex requirement:
   - The growth charts require knowing the patient's sex (boys vs girls have different curves)
   - For patients in the migration without explicit sex, infer from first name where possible (Albanian first names are usually gendered)
   - For ambiguous names or genuinely unknown, prompt the doctor to set sex on the patient record before showing charts
   - Sex is part of the patient master data (add `sex` enum field if not already in slice 7 schema)

6. Data point display:
   - Use only weight/height/head circumference data from saved visits (not pending edits)
   - If a visit has measurements but no date, fall back to created_at
   - Convert ages from DOB to "age at visit in months"

7. Edge cases:
   - Patient has 0 measurements: empty chart with helper text "Asnjë e dhënë e regjistruar"
   - Patient has 1 measurement: single dot, no line
   - Patient has measurements at unusual ages (e.g. 6 months and 30 months for the same chart): show only 0-24mo points on the standard chart, link to historical view for the older one

Constraints:
- WHO data is publicly available — embed as static JSON
- Charts use design tokens (teal for the patient's line, neutral grays for the percentile bands)
- All UI in Albanian
- Receptionist never sees these (clinical data, doctor-only)

Tests:
- Unit: age-in-months calculation from DOB and visit_date
- Unit: percentile band rendering
- Unit: data point filtering by age range
- Integration: chart loads for a patient with measurements at various ages
- E2E: open chart, see growth chart cards, click to expand, see full-size modal with all three tabs

Documentation:
- Document the WHO data source in docs/architecture.md
- Note WHO data is public domain (no licensing concerns)

Commit on branch `slice-14-growth-charts`.
```

---

# SLICE 15 — Print pipeline (Puppeteer) + visit report + vërtetim + history

**Goal:** All three printed document types — visit report (A5, page 1 + optional page 2 for ultrasound), vërtetim with date range flow, patient history.

## Prompt

```
Read CLAUDE.md and ADR-007 (PDF generation). Read design-reference/prototype/print-visit.html, print-certificate.html, print-history.html.

Build the complete print pipeline:

1. Server-side Puppeteer setup:
   - Long-lived browser instance via puppeteer-cluster (max 4 concurrent renders)
   - Sandbox mode, no internet egress (Docker config)
   - Headless, A5 portrait page, margins 15mm minimum
   - Print templates as HTML/CSS in apps/api/src/modules/print/templates/

2. Print templates:
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
   - Show small dialog with options (e.g. visit report: just confirm; history: toggle "Imazhet e ultrazerit (X imazhe)"; vërtetim: date range picker per design)
   - On confirm: fetch PDF, embed in hidden iframe, trigger browser print dialog
   - Iframe technique: `<iframe src="/api/print/visit/:id" hidden>` + iframe.contentWindow.print()

5. Vërtetim flow (per the design):
   - Click [Vërtetim] in chart action bar
   - Dialog opens with patient header (name + age)
   - Date range pickers + quick-select chips (Sot, 3 ditë, 5 ditë, 1 javë, 10 ditë)
   - Live preview card showing periudha + kohëzgjatja
   - Validation: Deri >= Nga
   - Actions: [Anulo] [Shiko vërtetimin] [Printo vërtetimin]
   - On issue: insert vertetim row with diagnosis snapshot, link to current visit, link to current patient
   - The vertetim record uses the diagnosis text frozen at issue time (per ADR 007)

6. Vërtetim history (in patient chart, slice 11):
   - Each entry: 👁 view (opens print preview with stored data) + 🖨 reprint (direct print)
   - View renders the EXACT same vërtetim that was originally issued (using diagnosis_snapshot)
   - No void flow, no duplicate warnings (simplified per locked decision)

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
   | Kontrolla, Tjera (visit) | ✗ | ✗ | ✗ |

8. Stamp area:
   - Reserved blank rectangle ~5×5cm, bottom-right of every printed page
   - Faint "Vendi i vulës" text label that appears in PREVIEW only (CSS @media screen)
   - Does NOT print on actual paper (CSS @media print hides the label)
   - The actual rectangle is always blank
   - **Never any digital stamp rendering**

9. Signature:
   - Doctor's scanned signature image (PNG) rendered at the signature line if uploaded
   - Otherwise blank line above "Dr. Taulant Shala — pediatër"
   - Always paired with the blank stamp area side-by-side

10. Audit log on print:
    - Action: print.visit_report.requested / print.vertetim.issued / print.history.requested
    - Records who, when, content snapshot

Constraints:
- Use Inter + Inter Display fonts (embedded as base64 in templates, no CDN fetches)
- Tabular numerals for all numeric values
- Page numbering "Faqe X/Y" on multi-page history
- Page breaks where natural (after the visit table, before ultrasound appendix)
- NO digital stamps — hard rule enforced at the template level

Tests:
- Unit: vertetim date range calculation (inclusive vs exclusive)
- Unit: print template field visibility matches the canonical table
- Integration: generate PDF for visit, vertetim, history → file is valid PDF, expected size
- Integration: vertetim with diagnosis_snapshot returns frozen text even if visit diagnosis later changes
- E2E: print visit report from chart → PDF opens in print dialog
- E2E: issue vërtetim → reprint identical document weeks later

Documentation:
- Update docs/architecture.md with the print pipeline diagram

Commit on branch `slice-15-print`.
```

---

# SLICE 16 — Orthanc integration + DICOM study picker + image viewer

**Goal:** Manual DICOM study picker (v1, MWL in v2). Doctor scans, pushes to Orthanc, opens visit, links a study. Linked images viewable in chart's Ultrazeri panel.

## Prompt

```
Read CLAUDE.md and ADR-009 (DICOM storage). Read design-reference/prototype/chart.html (Ultrazeri section).

Build the DICOM integration:

1. Orthanc Docker setup in infra/compose/:
   - Community Orthanc image
   - Storage volume mounted to /mnt/dicom-storage (on the 2TB HDD in production)
   - Configured for TLS (modality-side TLS)
   - Authentication enabled, credentials in .env (ORTHANC_USERNAME, ORTHANC_PASSWORD)
   - REST API behind authentication

2. Klinika ↔ Orthanc bridge module (apps/api/src/modules/dicom/):
   - Klinika authenticates to Orthanc as admin user
   - On Orthanc receive (DICOM C-STORE), trigger webhook to Klinika
   - Klinika stores metadata in `dicom_studies` table: orthanc_study_id, received_at, image_count, study_description, patient_name (DICOM patient name, used for fuzzy match suggestions)

3. API endpoints:
   - GET /api/dicom/recent — last 10 studies received from Orthanc (manual picker source)
   - GET /api/dicom/studies/:study_id — study details + image list
   - GET /api/dicom/instances/:instance_id/preview.png — rendered preview (cached)
   - GET /api/dicom/instances/:instance_id/full.dcm — full DICOM file (rare, authenticated, audited)
   - POST /api/visits/:visit_id/dicom-links — link a study to a visit
   - DELETE /api/visits/:visit_id/dicom-links/:link_id — unlink

4. Manual study picker UI (in patient chart Ultrazeri panel):
   - "Lidh studim të ri" button opens modal
   - Modal shows last 10 received DICOM studies
   - Each study card: timestamp (when received) + thumbnail strip + image count
   - Doctor clicks one → "Lidh me këtë vizitë" button
   - On link: dicom_study_id linked to current visit via visit_dicom_links

5. Linked studies display (in chart's Ultrazeri panel):
   - Thumbnails of linked studies
   - Click thumbnail → full-size lightbox viewer
   - Lightbox: arrow navigation, zoom (1x/2x), close on Esc

6. Image proxy:
   - Klinika serves DICOM images via authenticated proxy
   - Never expose Orthanc REST API directly to the browser
   - Browser fetches from /api/dicom/instances/:id/preview.png with session auth
   - Server fetches from Orthanc internally
   - Image headers: Cache-Control: private, no-store (images not cached, regulator-friendly)

7. Audit log on DICOM access:
   - Action: dicom.study.viewed (when picker is opened)
   - Action: dicom.study.linked (when linked to a visit)
   - Action: dicom.instance.viewed (when lightbox opens a specific image)

8. Storage monitoring:
   - Telemetry agent reports Orthanc disk usage hourly
   - Alerts at 80% and 95% per ADR-009

Constraints:
- DICOM images never leave the clinic LAN in raw form
- Browser only ever sees rendered PNG/JPEG previews
- Klinika authenticates to Orthanc with shared secret (rotated quarterly per runbook)
- Manual picker only in v1; MWL deferred to v2

Tests:
- Unit: DICOM study metadata parsing
- Unit: image preview generation (mock Orthanc response)
- Integration: link study to visit, unlink
- Integration: receptionist GET /api/dicom returns 403
- E2E: open manual picker, see studies, link one, see thumbnails in chart

Documentation:
- Add docs/architecture.md section on the DICOM bridge
- Add docs/deployment.md section on Orthanc setup for on-premise

Commit on branch `slice-16-dicom`.
```

---

# SLICE 17 — Migration tool (Python, Access → Postgres)

**Goal:** The migration tool that imports DonetaMED's 11k patients + 220k visits from MS Access. Idempotent via legacy_id. Produces a reconciliation report.

## Prompt

```
Read CLAUDE.md and ADR-010 (migration approach). Get the actual Access database at the path the user will provide (NOT committed to Git).

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
   a. Extract: use mdb-export to dump each Access table to CSV in a working directory
   b. Profile: count rows, flag anomalies, write profile-report.json
   c. Transform: apply mapping rules from config.yaml (asterisks stripped, dates parsed, payment codes mapped, etc.)
   d. Load: upsert into Postgres via psycopg with ON CONFLICT(clinic_id, legacy_id)
   e. Reconcile: count source rows vs target rows, write migration-report.json

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
       patient_link_column: "ALERT"   # fuzzy match by name
       patient_link_strategy: fuzzy_strip_asterisks
       date_column: Datar
       date_format: "MM/DD/YY"
       fields:
         complaint: Ankesa
         feeding_notes: Ushqimi
         # parse feeding_breast, feeding_formula, feeding_solid from feeding_notes text
         feeding_breast_keywords: ["Gji"]
         feeding_formula_keywords: ["Formul", "Formul"]
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
       skip: true   # vaccinations dropped entirely
   ```

5. Patient-visit linkage (fuzzy match from ALERT column):
   - For each visit row, extract the name from ALERT column
   - Strip asterisks
   - Find matching patient: exact match preferred, then last_word_is_last_name fuzzy match
   - On no match: log to migration_errors, skip visit
   - On multiple matches: pick the one with closest DOB if visit has a date, otherwise prompt or skip

6. Idempotency:
   - All inserts use ON CONFLICT (clinic_id, legacy_id) DO UPDATE
   - Re-runs update existing rows
   - Crashes are recoverable: re-run the tool

7. Outputs:
   - migration-report-YYYY-MM-DD.json: source_rows, destination_rows, skipped_rows, warnings_by_field, errors
   - migration-errors.csv: every row that failed to migrate, with reason

8. Pre-migration verification:
   - Doctor picks 20-30 patients he knows well
   - Tool produces "spot-check.html" — a page showing each picked patient's source vs target data side-by-side
   - Doctor reviews, flags discrepancies before cutover

9. Prescription line seeding:
   - During visit migration, parse each Terapia value line-by-line
   - Upsert into prescription_lines (per-doctor index from slice 13)
   - On day-one, autocomplete works with the doctor's historical patterns

Constraints:
- The Access file (.accdb) is NEVER committed to Git
- Migration runs in a Postgres transaction per table (commit after each table)
- Multi-tenant: every row gets clinic_id from config
- Asterisks stripped, SN dropped, vaccinations skipped — all from ADR 010

Tests:
- Unit: name splitting strategies
- Unit: date parsing for both formats
- Unit: feeding text → booleans
- Unit: asterisk stripping
- Integration: fixture CSVs → expected Postgres rows
- Integration: re-running the migration is idempotent (no duplicates)
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
Read CLAUDE.md and ADR-002 (deployment topology). Read docs/deployment.md (will be expanded in this slice).

Build the deployment infrastructure and execute the DonetaMED cutover:

1. Production cloud deployment (IONOS VPS at klinika.health):
   - Provision IONOS VPS in Frankfurt
   - Ubuntu LTS 24.04, Docker, Caddy
   - Configure Cloudflare DNS for *.klinika.health (wildcard) + klinika.health
   - Caddy auto-TLS with Let's Encrypt DNS challenge
   - Docker Compose stack: web, api, postgres, orthanc-disabled (cloud doesn't need DICOM), pg-boss worker
   - GitHub Actions workflow: tag push → build images → push to GHCR → SSH via Tailscale → docker compose pull && up -d
   - Health check + rollback on failure
   - Run telemetry agent

2. On-premise install at DonetaMED:
   - Mini-PC arrives at the clinic
   - Install Ubuntu LTS 24.04, Docker, Caddy
   - Configure Cloudflare Tunnel from clinic to klinika.health (for remote access)
   - Configure split-horizon DNS: donetamed.klinika.health resolves to the clinic's LAN IP for clinic devices, public IP via tunnel for remote
   - Docker Compose with all services including Orthanc
   - Mount /mnt/dicom-storage on the 2TB HDD
   - Configure ultrasound to push DICOM to this Orthanc
   - Run telemetry agent (heartbeats to klinika.health)
   - Schedule encrypted backups to Backblaze B2 (Postgres dump + Orthanc storage, via restic, nightly differential + weekly full)

3. RAID 1 recommendation:
   - Document hardware setup in docs/deployment.md
   - mdadm setup for software RAID 1 (Linux)
   - SMART monitoring alerts

4. Cutover sequence (executed once on agreed date):
   - Friday afternoon: backup Access DB, freeze it as read-only
   - Saturday: run migration tool against staging copy first, verify spot-check
   - Saturday afternoon: run migration tool against production Postgres on the mini-PC
   - Saturday evening: doctor verifies known patients in production app
   - Sunday: app stays available for any final verification
   - Monday morning: doctor starts using Klinika instead of Access

5. Documentation completion:
   - docs/deployment.md: complete cloud + on-premise procedures
   - docs/runbook.md: complete recovery procedures, alert response
   - docs/data-migration.md: complete migration walkthrough

6. Cloudflare configuration:
   - klinika.health: A record to IONOS IP
   - *.klinika.health: CNAME to klinika.health
   - admin.klinika.health: behind Cloudflare Access policy (allowlist platform admin email)
   - donetamed.klinika.health: configured for split-horizon DNS (Cloudflare tunnel + local override at clinic)

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
- Doctor trains on the app for 1-2 hours in-person before cutover
- Online help reference at klinika.health/help is available
- Founder on-call for the first 2 weeks post-cutover

Tests:
- Manual smoke tests as listed above
- Backup restore tested before cutover (restore Postgres from B2 to a test VM, verify integrity)

Documentation:
- All deployment docs complete and verified
- Runbook tested end-to-end

Commit on branch `slice-18-deploy-cutover`.
```

---

## Post-launch (not part of v1 slices)

After cutover, the first 2 weeks are observation + bug fixing. No new features. The doctor uses the app, reports issues, you fix them with focused Claude Code sessions targeting specific bugs.

After 2 weeks: retrospective. What worked? What surprised? What should be in v2?

Likely v2 features:
- DICOM MWL (Modality Worklist) — automatic study-patient linkage
- AI features (clinical summary, smarter autocomplete)
- Appointment reminders (when patient contact data is captured routinely)
- Vërtetim history with more detail
- Marketing landing page at klinika.health
- Onboarding flow for additional clinics
- Billing integration

Each becomes its own slice in a v2 plan.
