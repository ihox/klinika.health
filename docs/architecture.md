# Klinika — Architecture

> Living document. Sections are filled in as slices land.
> See [`CLAUDE.md`](../CLAUDE.md) for non-negotiables and
> [`docs/decisions/`](decisions/) for the architectural reasoning behind each
> choice.

## Table of contents

1. System overview
2. Service boundaries
   1. `apps/web` — Next.js 15 frontend
   2. `apps/api` — NestJS 10 backend
   3. `tools/migrate` — Python Access → Postgres migrator
   4. Postgres 16 — primary data store
   5. Orthanc — DICOM image store
3. Multi-tenancy model
4. Authentication and sessions
5. Authorization (roles + RBAC matrix)
6. Audit log
7. PHI handling and logging discipline
8. Auto-save subsystem
9. Soft-delete + undo subsystem
10. PDF generation pipeline
11. Background jobs (pg-boss)
12. Time zone strategy (Europe/Belgrade)
13. Rate limiting and CORS
14. Deployment topologies (cloud + on-premise)
15. Observability
16. Data lifecycle and backups
17. Slice 08 — receptionist calendar and appointment lifecycle

## Slice 01 — skeleton

This slice establishes the repository structure, two minimal apps, and the
local Docker Compose stack. No clinical data, no auth, no PHI. See
`SLICE-PLAN.md` for the slice sequence.

### Local stack

```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│  web :3000       │───▶│  api :3001       │───▶│  postgres :5432  │
│  Next.js 15      │    │  NestJS 10       │    │                  │
└──────────────────┘    └──────────────────┘    └──────────────────┘
                                                ┌──────────────────┐
                                                │  orthanc :8042   │
                                                └──────────────────┘
```

All containers run `TZ=Europe/Belgrade` per [ADR-006](decisions/006-time-zones.md).
Repository layout follows [ADR-001](decisions/001-repo-structure.md).

## Slice 02 — schema

This slice lays down the persistent shape of Klinika: Prisma 5 + Postgres
16 + Row-Level Security policies + a NestJS-side `PrismaService` that
enforces tenant context and soft-delete on every query.

### Tables

Single shared database. Tenant isolation is enforced by RLS, not by
schema-per-tenant. The 14 tables fall into five groups:

| Group           | Tables                                                      | Notes                                                                                  |
|-----------------|-------------------------------------------------------------|----------------------------------------------------------------------------------------|
| Tenancy         | `clinics`, `users`, `platform_admins`                       | `clinics.subdomain` is the public identifier resolved at the edge.                     |
| Clinical core   | `patients`, `visits`, `visit_diagnoses`, `icd10_codes`, `prescription_lines` | `visit_diagnoses` FK → `icd10_codes`; `icd10_codes` is reference data, no `clinic_id`. |
| Scheduling      | `appointments`                                              | `scheduled_for TIMESTAMPTZ`; renders in Europe/Belgrade.                               |
| Documents       | `vertetime`, `dicom_studies`, `visit_dicom_links`           | Vërtetime are immutable once issued (no `updated_at`, no soft delete).                 |
| Audit           | `audit_log`                                                 | Append-mostly; coalesces consecutive same-user same-resource writes in service code.   |

The Prisma schema at [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma)
is the single source of truth and is fully commented model-by-model.

### Multi-tenancy enforcement (ADR-005)

Three layers of defence:

1. **UI** — the SPA loads a clinic context once and components scope to it.
2. **API** — `ClinicScopeGuard` (later slice) parses `Host` into `clinic_id`
   and stamps `request.clinicId`; every service must filter by it.
3. **Database** — `ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` on
   every table that carries `clinic_id`, with a single policy:

   ```sql
   USING (clinic_id = current_setting('app.clinic_id', true)::uuid)
   WITH CHECK (clinic_id = current_setting('app.clinic_id', true)::uuid);
   ```

   The `PrismaService.runInTenantContext(clinicId, fn)` helper opens a
   transaction and `SET LOCAL`s `app.clinic_id` so the policy resolves
   to the caller's UUID. The `, true` second argument to `current_setting`
   returns `NULL` when the setting is missing, causing the comparison to
   evaluate false and **fail closed** if a caller forgets to scope.

   Platform-admin and migration code uses the `platform_admin_role`
   Postgres role (`BYPASSRLS`) for cross-tenant operations. The role is
   `NOLOGIN`; it's acquired via `SET ROLE` from an authenticated
   connection.

### Soft delete (ADR-008)

Five tables have `deleted_at TIMESTAMPTZ NULL`: `clinics`, `users`,
`patients`, `visits`, `appointments`. The `PrismaService` middleware
injects `WHERE deleted_at IS NULL` into every read (`findUnique`,
`findFirst`, `findMany`, `count`, `aggregate`, `groupBy`) on those
models. Writes are untouched — delete operations set `deleted_at` and
the 30-second "Anulo" toast resets it.

### Timestamps and triggers

* `created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP` on every
  table — Prisma generates the default.
* `updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP` on every
  table with mutations — Prisma sets it via `@updatedAt`, AND a
  `set_updated_at` trigger overrides it so raw-SQL writes (migrations,
  hot-fixes, the migration tool) stay correct.
* All values stored in UTC, rendered in `Europe/Belgrade`.

### Indexes

Prisma generates the obvious indexes (PKs, FKs, uniques, `@@index`).
The manual SQL migration adds:

* `(clinic_id, deleted_at)` on `users`, `patients`, `visits`,
  `appointments` — matches the soft-delete-aware tenant query pattern.

Prisma already provides `(clinic_id, legacy_id)` UNIQUE on `patients`
and `visits`, and `(clinic_id, timestamp)` + `(resource_type, resource_id)`
on `audit_log`, so they aren't repeated.

### Slow-query logging

`PrismaService.handleQueryEvent` filters Prisma's `query` event stream
and logs a Pino warn when `duration_ms >= PRISMA_SLOW_QUERY_MS`
(default 500). The log payload contains the **parameterised SQL
skeleton** and the duration — never the parameter array, which may
contain PHI (patient names, diagnoses, free-text notes). CLAUDE.md §7.

### Seed

`apps/api/prisma/seed.ts` (run via `make db-seed`) inserts:

* The DonetaMED clinic with real hours and payment codes.
* One platform admin (`founder@klinika.health`).
* One doctor (Dr. Taulant Shala) and one receptionist (Erëblirë Krasniqi).
* Every row in `apps/api/prisma/fixtures/icd10.csv` — a development
  pediatric subset; replace with the full WHO Latin dataset before
  production cutover (see `prisma/fixtures/README.md`).

Passwords come from `SEED_PLATFORM_ADMIN_PASSWORD`,
`SEED_DOCTOR_PASSWORD`, `SEED_RECEPTIONIST_PASSWORD` env vars — never
hard-coded — and must be ≥ 12 characters or the seed aborts.

### Applying the migration

```bash
make dev            # bring up Postgres + Orthanc + api + web
make db-migrate     # prisma migrate deploy + manual SQL (RLS, triggers, indexes)
make db-seed        # populate clinic, users, ICD-10
```

Re-running `make db-migrate` and `make db-seed` is safe — both are
idempotent.

## Slice 03 — observability

This slice lays down structured logging with PHI redaction, health
endpoints, the telemetry agent that phones home every minute, the
platform-side receiver, the alert engine, and a frontend connection
indicator. Telemetry is deliberately best-effort (ADR-003); failures
never crash the host process and never block a clinical request.

### Pino logging

All logs flow through `nestjs-pino` configured in
[`apps/api/src/common/logging/`](../apps/api/src/common/logging/).
The configuration is centralised so PHI redaction and request-ID
propagation apply uniformly across every module.

* **Output.** Structured JSON in production; `pino-pretty` in
  development (controlled by `NODE_ENV`).
* **Level.** `info` in production, `debug` in development, `silent`
  in tests. Override with `LOG_LEVEL`.
* **Request ID.** Generated per request (UUID v4) or taken from an
  inbound `x-request-id` header — useful for end-to-end correlation
  with the SPA. The chosen ID is echoed back as `x-request-id` so the
  browser knows what to reference.
* **Standard fields.** Every log line carries `timestamp`, `level`,
  `requestId`. When the request has been through `ClinicScopeGuard`
  and the auth pipeline (later slices), `userId` and `clinicId` are
  attached via `pinoHttp.customProps`.
* **Health endpoint noise.** `/health*` requests log at `debug`, not
  `info`, so the 30-second poll from the frontend doesn't drown the
  signal.

#### PHI redaction

Per CLAUDE.md §1.3, no PHI may appear in logs. Defence-in-depth:

1. **Authors don't log PHI.** Conventional logger calls take
   identifiers (`{ patientId, visitId }`), never names or free-text.
2. **Pino redacts.** Every field name on the redaction list resolves
   to `[Redacted]` at serialisation time. The list — defined in
   [`redaction.ts`](../apps/api/src/common/logging/redaction.ts) — covers
   every clinical free-text column, every name/contact field, and
   wildcards across the common nesting prefixes (`body.*`, `req.body.*`,
   `patient.*`, `visit.*`, `payload.*`, `changes[*].old/new`).
3. **Tests enforce the contract.** [`redaction.spec.ts`](../apps/api/src/common/logging/redaction.spec.ts)
   pipes a real pino instance through an in-memory stream and asserts
   that nothing leaks for the documented field set.

### Health endpoints

All under `/health` on the API:

| Path | Purpose | Status logic |
|---|---|---|
| `GET /health` | Liveness (process alive) | Always 200 if the process answers. |
| `GET /health/ready` | Readiness — DB reachable | 200 when `SELECT 1` succeeds, 503 otherwise. |
| `GET /health/deep` | Full snapshot for telemetry | DB latency, Orthanc reachability, CPU/RAM/disk percentages. |

`/health/deep` is never exposed publicly — Caddy 403s it from the
public internet in production; only the local telemetry agent (same
host) and authenticated platform admins reach it. The endpoint itself
performs no auth, by design: the gate lives at the network edge.

### Telemetry agent

Lives in [`apps/api/src/modules/telemetry/`](../apps/api/src/modules/telemetry/).
Three pg-boss scheduled jobs:

| Job | Schedule | Role | Action |
|---|---|---|---|
| `telemetry.heartbeat` | `* * * * *` | every install | Collect snapshot, POST to platform |
| `telemetry.offline-sweep` | `* * * * *` | platform only | Detect tenants with no recent heartbeat |
| `telemetry.retention` | `30 3 * * *` | platform only | Prune heartbeats older than 90 days |

The agent role is controlled by `TELEMETRY_ROLE` (`agent` or
`platform`). The platform tenant runs as `platform` and emits its own
heartbeats; cloud-hosted and on-premise installs run as `agent`.

**Payload shape** (see [`telemetry.types.ts`](../apps/api/src/modules/telemetry/telemetry.types.ts)):
metadata only — tenant ID, version, health flags, CPU/RAM/disk
percentages, queue depth, last-backup timestamp, active sessions,
error rate. The `telemetry-collector.service.spec.ts` test scans
every key and value against the redaction field list to verify no
PHI leaks. The receiver re-runs that check before persisting,
dropping unexpected keys into a `payload` JSONB column with PHI
keys stripped.

**Failure handling.** Every error is caught and logged. The agent
must never crash the host process or block a clinical request.
Network failures on the heartbeat POST log a warning and return.
pg-boss start failures log an error and the agent silently no-ops
until the next boot.

### Alert engine

The engine (see [`alert-engine.service.ts`](../apps/api/src/modules/telemetry/alert-engine.service.ts))
runs in two modes:

1. **Synchronously**, after each heartbeat is persisted. The
   `derive()` function maps a payload to zero-or-more alerts using
   pure rules (disk thresholds, health flags, backup age). Critical
   alerts get `notifiedAt = now()` on insert and fire the
   immediate-notification job; warnings stay `notifiedAt = NULL` and
   are picked up by the daily 9am digest.
2. **On the platform-side sweep job**, which queries
   `telemetry_heartbeats` for tenants that have stopped reporting.

**Dedupe.** Every alert carries a `dedupeKey` whose granularity
matches the alert's natural retry window (per-day for disk, per-hour
for transient health checks, per-5-minute window for offline detection).
The engine skips inserts when an identical key already exists.

**Smart grouping.** When the offline sweep finds ≥3 tenants offline
simultaneously, it downgrades the per-tenant alerts to `warning` and
inserts a single `critical` `tenant_offline` row scoped to
`tenant_id='platform'`. The operator gets one page, not three.

### Frontend connection status

[`apps/web/components/connection-status.tsx`](../apps/web/components/connection-status.tsx)
shows a small corner indicator. Polls `/health/ready` every 30s,
listens to `window.online/offline` events for fast-path updates, and
surfaces four states (`online`, `degraded`, `offline`, `unknown`)
each with an Albanian label and a color (no emoji — CLAUDE.md §1.12).
A 503 from readiness surfaces as `degraded` (the API is up, the DB
is not), distinct from a full network drop.

### Tables

Two new tables added by the
[`20260513150000_telemetry`](../apps/api/prisma/migrations/20260513150000_telemetry/)
migration:

* `telemetry_heartbeats` — 90-day retention, indexed by
  `(tenant_id, received_at)`.
* `telemetry_alerts` — append-only, indexed by `(tenant_id, created_at)`
  and `(severity, notified_at)`. `dedupeKey` is application-enforced.

Both tables are platform-side only and have no `clinic_id` (they live
outside the tenant data model — `tenant_id` here is a subdomain
string, not a UUID FK).

### Runbook

Operator procedures for the three most common alerts (tenant offline,
backup failed, disk full) live in [`runbook.md`](runbook.md).

## Slice 04 — authentication

See [ADR-004](decisions/004-authentication.md) for the why, and CLAUDE.md
§5.1, §7, §9 for the standing rules this slice implements.

### Stack

* **Better-Auth** (1.2.8) is pinned as the auth dependency and surfaces
  its Argon2 password helpers + 2FA primitives. Because we need
  multi-tenant subdomain routing, audit log integration, and Albanian
  email templates, **the HTTP handlers themselves are NestJS code** in
  [`apps/api/src/modules/auth/`](../apps/api/src/modules/auth/) — Better-Auth
  is used as a library, not as a router. The Better-Auth instance
  itself is built in [`better-auth.config.ts`](../apps/api/src/modules/auth/better-auth.config.ts)
  so the version pin is checked at compile time.
* **argon2** (0.41.1) for password hashing (`argon2id`, m=19456, t=2, p=1).
* **resend** for transactional email (capturing sender used in dev/test
  when `RESEND_API_KEY` is unset).
* **zod** for request validation; types flow to the frontend via
  inferred Zod types.

### Tables

[`20260513170000_auth`](../apps/api/prisma/migrations/20260513170000_auth/)
adds six tables:

| Table | Purpose | TTL |
|---|---|---|
| `auth_sessions` | Session cookies (SHA-256 of token at rest) | 8 h short / 30 d long |
| `auth_trusted_devices` | Device-trust cookies that skip MFA | 30 d |
| `auth_mfa_codes` | 6-digit email codes (hashed) | 15 m |
| `auth_login_attempts` | Append-only forensic record | 90 d |
| `auth_password_reset_tokens` | Single-use reset tokens | 60 m |
| `rate_limits` | Sliding-window counters | up to 1 h |

Manual migration
[`002_auth_rls.sql`](../apps/api/prisma/migrations/manual/002_auth_rls.sql)
adds Row-Level Security on the three tenant-scoped auth tables and the
`purge_expired_auth()` cleanup function.

### Flow

```
              donetamed.klinika.health
              ┌──────────────────────────────────────────┐
[1] POST /api/auth/login (email + password)            [3] cookie set:
    └─→ verify pwd → audit attempt                       klinika_session=…
        ├─ trusted-device cookie matches user → ────────▶│
        │  issue session (skip MFA)
        └─ no trusted cookie → issue MFA challenge
           └─→ email 6-digit code to user
[2] POST /api/auth/mfa/verify                          [4] also:
    └─→ verify code (hash compare)                       klinika_trust=…
        └─ check + mark code consumed                    (if mos pyet checked)
           └─→ issue session
```

### Multi-tenancy enforcement

[`ClinicResolutionMiddleware`](../apps/api/src/common/middleware/clinic-resolution.middleware.ts)
resolves `donetamed.klinika.health` → `clinic_id` on every request,
populates `req.ctx`, and exposes it via the `@Ctx()` decorator.
[`ClinicScopeGuard`](../apps/api/src/common/guards/clinic-scope.guard.ts)
asserts the context is present (or the request is on `admin.klinika.health`
for platform admins). The auth flow joins `users.clinicId` against
`ctx.clinicId` so a user from clinic A cannot log in on clinic B's
subdomain — integration-tested in
[`auth.integration.spec.ts`](../apps/api/src/modules/auth/auth.integration.spec.ts).

### Rate limiting

[`RateLimitService`](../apps/api/src/modules/rate-limit/rate-limit.service.ts)
uses Postgres `ON CONFLICT` upserts so the limit can't be bypassed by
parallel requests. Configured limits (CLAUDE.md §9):

| Endpoint | Limit |
|---|---|
| `POST /api/auth/login` | 5/min/IP + 10/hour/email |
| `POST /api/auth/mfa/send` (resend) | 3/min/email |
| `POST /api/auth/mfa/verify` | 5/min/pendingSessionId |
| `POST /api/auth/password-reset/request` | 3/hour/email |

### Audit events

Every auth event writes to `audit_log`:

* `auth.login.success` / `auth.login.failed`
* `auth.mfa.sent` / `auth.mfa.verified`
* `auth.device.trusted` / `auth.device.revoked`
* `auth.password.changed` / `auth.password.reset.requested`
* `auth.sessions.revoked` / `auth.logout`

`changes` is NULL for these (the action verb is the signal; no
field-diff applies).

## Slice 05 — platform admin

This slice introduces the `admin.klinika.health` surface: a separate web
area for platform-level tenant management, with its own auth stack, its
own audit log, and explicit cross-tenant data access. Documentation
specific to provisioning a tenant lives in
[`docs/deployment.md`](deployment.md#provisioning-a-new-tenant).

### Platform admins live outside the tenant model (ADR-005)

The `platform_admins` table is deliberately separate from `users`:

* No `clinic_id` — platform admins are cross-tenant by design.
* No `deleted_at` — admin accounts are toggled active/inactive instead,
  with permanent removal via SQL by the founder.
* The DB role used for queries that legitimately span tenants
  (`platform_admin_role`) has `BYPASSRLS`. Application code currently
  runs as a single connection that's also BYPASSRLS-capable; the
  separation matters more in production where the planned split is one
  role per access pattern.

Three parallel auth tables back the admin flow:

| Table                  | Purpose                                                                           |
|------------------------|-----------------------------------------------------------------------------------|
| `auth_admin_sessions`  | Server-side session storage for platform admins. 8-hour TTL, no remember-me.       |
| `auth_admin_mfa_codes` | Email-delivered 6-digit codes. MFA fires on every admin login (no trusted device). |
| `platform_audit_log`   | Append-only record of admin actions (tenant create/suspend/activate, admin create).|

The session cookie name (`klinika_admin_session`) deliberately differs
from the tenant `klinika_session` so a leaked tenant session can never
be mistaken for an admin session at the API.

### Suspended tenants

`clinics.status` is one of `active` | `suspended`. When a platform admin
calls `POST /api/admin/tenants/:id/suspend`:

1. The clinic row flips to `suspended`.
2. Every active tenant session is revoked with `revoked_reason =
   'tenant_suspended'` (in the same transaction).
3. A `tenant.suspended` row is written to `platform_audit_log`.

The
[`ClinicResolutionMiddleware`](../apps/api/src/common/middleware/clinic-resolution.middleware.ts)
fetches `status` along with `clinic_id` on every request, and the
[`ClinicScopeGuard`](../apps/api/src/common/guards/clinic-scope.guard.ts)
rejects every non-admin request to a suspended tenant subdomain with a
403 carrying `reason: 'clinic_suspended'`. The web layer's login form
reads that reason and redirects to `/suspended`.

Activation (`POST /api/admin/tenants/:id/activate`) flips the status
back. Sessions are NOT auto-resurrected — users sign in fresh. Trusted
devices remain so MFA isn't required on the first post-resume login.

### Admin endpoints

| Endpoint                                                | Description                                                  |
|---------------------------------------------------------|--------------------------------------------------------------|
| `POST /api/admin/auth/login`                            | Email + password. Always returns `mfa_required`.             |
| `POST /api/admin/auth/mfa/verify`                       | 6-digit code → session cookie.                               |
| `POST /api/admin/auth/mfa/resend`                       | New code, previous expired.                                  |
| `GET  /api/admin/auth/me`                               | Profile of the authenticated admin.                          |
| `POST /api/admin/auth/logout`                           | Revoke session, clear cookie.                                |
| `GET  /api/admin/tenants`                               | List all tenants with summary metrics.                       |
| `GET  /api/admin/tenants/subdomain-availability`        | Live subdomain check (format + reserved + uniqueness).       |
| `POST /api/admin/tenants`                               | Create tenant + first clinic admin user + setup email.       |
| `GET  /api/admin/tenants/:id`                           | Tenant detail with telemetry, users, recent audit.           |
| `POST /api/admin/tenants/:id/suspend`                   | Suspend; revoke sessions.                                    |
| `POST /api/admin/tenants/:id/activate`                  | Activate.                                                    |
| `GET  /api/admin/platform-admins`                       | List platform admins.                                        |
| `POST /api/admin/platform-admins`                       | Create platform admin + setup email.                         |
| `GET  /api/admin/health`                                | Platform-wide rollup (tenant counts, recent alerts, system). |

Every admin endpoint is gated by `AdminAuthGuard` (validates the admin
session cookie) and the `@AdminScope()` marker (rejects requests that
arrive on a tenant subdomain instead of `admin.klinika.health`). In
production the `/admin` path is further gated by Cloudflare Access — see
[`deployment.md`](deployment.md#cloudflare-access-for-admin).

### Reserved subdomains

Tenant subdomains pass through
[`validateSubdomain`](../apps/api/src/modules/admin/subdomain-validation.ts)
on both the create endpoint and the live availability check. The
reserved-word list blocks names the platform itself serves: `admin`,
`www`, `api`, `mail`, `support`, `app`, `status`, `help`, `docs`,
`static`, `cdn`, `auth`, `login`, `staging`, `test`, `dev`,
`internal`, `klinika`.

## Slice 07 — patient model with role-scoped DTOs

This slice establishes the patient model and the **role-scoped DTO
pattern** — the single most load-bearing privacy mechanism in Klinika.

### The role-scoped DTO pattern

CLAUDE.md §1.2 ("receptionist sees only patient name and DOB") is the
non-negotiable rule that drives this slice. Postgres RLS enforces
cross-tenant isolation but does NOT help here: receptionist and doctor
read the *same* `patients` rows; the question is which columns reach
the wire. The pattern:

1. **One row, two DTOs.**
   [`PatientPublicDto`](../apps/api/src/modules/patients/patients.dto.ts)
   exposes exactly `id`, `firstName`, `lastName`, `dateOfBirth`.
   `PatientFullDto` exposes every master-data field.
2. **Single chokepoint.** Controllers never spread Prisma rows into
   responses. They call `toPublicDto()` / `toFullDto()`, which build
   each response object field-by-field. A future column on the
   `patients` table can NOT leak into the receptionist response unless
   someone explicitly extends `PatientPublicDto` AND `toPublicDto` AND
   updates the unit test that asserts the exact key set.
3. **Defense in depth at the SELECT.**
   [`PatientsService.selectForRole`](../apps/api/src/modules/patients/patients.service.ts)
   restricts the Prisma `select` clause to the receptionist's four
   columns. If a maintainer ever forgets the DTO converter, the row
   itself doesn't contain the forbidden columns.
4. **Role-scoped request bodies.**
   `ReceptionistCreatePatientSchema` is `.strict()`: tampering with the
   body to inject `phone`/`alergjiTjera` triggers a 400. Even if
   strictness ever loosens, the service explicitly writes only the
   three permitted fields — `phone`, `alergjiTjera`, `birthWeightG`,
   etc. are never read from the receptionist's payload at any layer.
5. **TypeScript reinforcement on the frontend.**
   [`apps/web/lib/patient-client.ts`](../apps/web/lib/patient-client.ts)
   exposes `PatientPublicDto` and `PatientFullDto` as separate types.
   The receptionist screen imports `PatientPublicDto` only; a build
   error catches accidental rendering of doctor-only fields.
6. **Property-style tests.** `patients.dto.spec.ts` proves the
   chokepoint never returns keys outside the four allowed even when
   given a fully-populated row plus 200 garbage extras; the
   integration test proves the wire contract holds end-to-end.

The same pattern generalises to every future role/data combination:
when role A is a strict subset of role B's view, define both DTOs
explicitly, write the chokepoint converter, and pin the contract with
a property-style unit test plus an HTTP-layer integration test. No
shortcuts — patient privacy is the rule that doesn't bend.

### Fuzzy search

Patient lookup uses Postgres `pg_trgm` for trigram similarity and
`unaccent` for diacritic-insensitive matching. The
[`klinika_unaccent_lower`](../apps/api/prisma/migrations/manual/004_patients_search.sql)
IMMUTABLE wrapper composes the two and powers three GIN indexes:

- `patients_first_name_trgm_idx`
- `patients_last_name_trgm_idx`
- `patients_full_name_trgm_idx` (on `first_name || ' ' || last_name`)

The query also accepts a 4-digit year (interpreted as DOB year) and a
`#`-prefixed integer (interpreted as `legacy_id` from the Access
migration). Tokens are classified by
[`parseSearchTerm`](../apps/api/src/modules/patients/patients.service.ts);
unit tests pin the classifier.

### Soft duplicate notice (informational only)

Per the locked design decision, the receptionist's quick-add modal
shows likely duplicates as the user types — but NEVER blocks creation.
`POST /api/patients/duplicate-check` returns up to 5 candidates with
trigram similarity ≥ 0.55 and DOB within ±14 days. Both candidates and
"continue as new" produce a `PatientPublicDto` — even at the most
suggestive moment, the receptionist sees only id + name + DOB.

### Endpoints

| Endpoint                                | Roles                          | Response shape         |
|-----------------------------------------|--------------------------------|------------------------|
| `GET /api/patients?q=...`               | doctor / receptionist / admin  | role-scoped            |
| `POST /api/patients/duplicate-check`    | doctor / receptionist / admin  | `PatientPublicDto[]`   |
| `POST /api/patients`                    | doctor / receptionist / admin  | role-scoped            |
| `GET /api/patients/:id`                 | doctor / clinic_admin          | `PatientFullDto`       |
| `PATCH /api/patients/:id`               | doctor / clinic_admin          | `PatientFullDto`       |
| `DELETE /api/patients/:id`              | doctor / clinic_admin          | `{ restorableUntil }`  |
| `POST /api/patients/:id/restore`        | doctor / clinic_admin          | `PatientFullDto`       |

Every mutation emits an audit-log row. `GET /:id` writes a
`patient.viewed` row with `changes: null` per CLAUDE.md §5.3
(sensitive read).

## Slice 08 — receptionist calendar and appointment lifecycle

The receptionist's daily working surface is a six-day calendar grid
(today + the next five OPEN clinic days; closed days are skipped per
`hours_config`). The visit timeline of an appointment moves through a
state machine that captures the realities of a busy pediatric front
desk:

```
                  (receptionist creates from picker)
                              │
                              ▼
                       ┌─────────────┐
                       │  scheduled  │
                       └─────┬───────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   (doctor saves visit) (no-show)        (cancelled at door)
            │                │                │
            ▼                ▼                ▼
       completed          no_show         cancelled
            │                │                │
            └────── soft-delete (set deleted_at) ──────┐
                                                       ▼
                                                   (purged
                                                    later by
                                                    admin CLI)
```

Five guarantees frame the design:

1. **Receptionist sees only name + DOB on cards.** Per CLAUDE.md §1.2
   and §8, the API response shape (`AppointmentDto`) inlines exactly
   `patient.firstName`, `patient.lastName`, `patient.dateOfBirth` — and
   nothing else from the patient row. No clinical context, no payment
   code, no address, even though some of those fields exist on the
   underlying `patients` table.
2. **Conflict detection is server-authoritative.** The frontend offers
   a snap-to-10-min visual ghost, but every create + update goes
   through the same `findConflict()` check on the server. Two
   appointments overlap iff `aStart < bEnd && bStart < aEnd`; a row
   that matches gets a 400 with `reason: 'conflict'` and a localised
   Albanian message. The check excludes the row being updated so a
   pure status change can't conflict with itself.
3. **Working hours come from `hours_config` JSONB, not code.** Each
   clinic defines its own open days and times in
   [`clinic-settings.dto.ts`](../apps/api/src/modules/clinic-settings/clinic-settings.dto.ts);
   the appointment service rejects any slot before open or past close
   with `reason: 'before_open' | 'after_close' | 'closed_day'`. Sundays
   default closed for DonetaMED; the schema allows arbitrary closed
   days for future tenants.
4. **Audit log captures every transition.** `appointment.created`,
   `appointment.updated`, `appointment.completed` (from a linked visit
   save), `appointment.deleted`, `appointment.restored`. Successive
   saves coalesce via the same 60-second window the audit log uses
   for every resource; the receptionist's "Cancel → re-schedule"
   flurry shows up as one row in the audit panel.
5. **Real-time receptionist updates without page reload.** Slice 11/12
   will wire `appointments.markCompletedFromVisit()` into the visit
   save path; the appointment row flips to `completed` and the
   receptionist's grid receives a `appointment.updated` SSE event over
   `GET /api/appointments/stream`. The event carries only the
   appointment id + local day — never a patient name (CLAUDE.md §1.3).
   If SSE fails, the calendar polls stats every 30s as a backstop.

### Color indicator chip (last-visit recency)

The grid surfaces a small green/yellow/red chip on each card so the
receptionist can spot the "patient was here yesterday" case at a glance:

| Days since last visit | Color  |
|-----------------------|--------|
| no prior visit        | (none) |
| ≤ 7 days              | red    |
| 7–30 days             | yellow |
| > 30 days             | green  |

The mapping lives in
[`colorIndicatorForLastVisit`](../apps/api/src/modules/appointments/appointments.dto.ts)
and is re-exported to the frontend
([`appointment-client.ts`](../apps/web/lib/appointment-client.ts)).
The server pre-computes the lookup map (one GROUP BY against
`visits`) and embeds `lastVisitAt` + `isNewPatient` on every DTO so
the grid never issues an N+1.

### Time zone discipline

`scheduled_for` is `TIMESTAMPTZ` stored in UTC; the UI renders in
`Europe/Belgrade`. The conversion helpers
([`appointments.tz.ts`](../apps/api/src/modules/appointments/appointments.tz.ts))
handle DST transitions (CET ↔ CEST) by recomputing the offset at the
resolved instant, not by hard-coding `+01:00` / `+02:00`. The
round-trip is pinned by a unit test that includes the spring-forward
and fall-back days.

### End-of-day prompt

Past appointments still in `scheduled` after the clinic closes surface
as a soft prompt at the top of the next morning's calendar
(`GET /api/appointments/unmarked-past`). The receptionist gets a
dropdown of {Kryer, Mungoi, Anulluar} per row; the system never
auto-marks. Older than seven days drops out of the list — at that
point the entry is treated as a record of what actually happened, not
a TODO. Each mark emits an `appointment.updated` audit row.

### Endpoints

| Endpoint                                              | Roles                              | Response                          |
|-------------------------------------------------------|------------------------------------|-----------------------------------|
| `GET /api/appointments?from=...&to=...`               | doctor / receptionist / admin      | `{ appointments, serverTime }`    |
| `GET /api/appointments/stats?date=...`                | doctor / receptionist / admin      | `AppointmentStatsResponse`        |
| `GET /api/appointments/unmarked-past`                 | doctor / receptionist / admin      | `{ appointments }`                |
| `POST /api/appointments`                              | doctor / receptionist / admin      | `{ appointment }`                 |
| `PATCH /api/appointments/:id`                         | doctor / receptionist / admin      | `{ appointment }`                 |
| `DELETE /api/appointments/:id`                        | doctor / receptionist / admin      | `{ restorableUntil }`             |
| `POST /api/appointments/:id/restore`                  | doctor / receptionist / admin      | `{ appointment }`                 |
| `GET /api/appointments/stream` (SSE)                  | doctor / receptionist / admin      | event-stream                      |

All endpoints are clinic-scoped at the API layer (`ClinicScopeGuard`)
and reinforced by Postgres RLS on `appointments`. The SSE bus filters
by `clinicId` before delivering events so a receptionist on tenant A
never sees an event from tenant B even if a future refactor forgets
to pass scope down.


