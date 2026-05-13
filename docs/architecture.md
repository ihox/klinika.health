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
