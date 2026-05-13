# ADR 005: Multi-tenancy via subdomains and Row-Level Security

Date: 2026-05-13
Status: Accepted

## Context

Klinika is multi-tenant from day one. Each clinic is a tenant with its own data, users, settings, and (for on-premise installs) its own infrastructure. We need to ensure that:
- No clinic ever sees another clinic's data
- Cross-tenant isolation is enforced at multiple layers (defense in depth)
- The architecture scales to dozens of clinics without redesign
- Per-clinic configuration (logos, working hours, payment codes) is straightforward

Options considered:
- **Subdomain-based routing** (`donetamed.klinika.health`) with shared database
- **Path-based routing** (`klinika.health/donetamed`) with shared database
- **Database-per-tenant** with shared application
- **Schema-per-tenant** in a shared database
- **Instance-per-tenant** (one full stack per clinic)

## Decision

**Subdomain-based routing + shared Postgres database + Row-Level Security policies.**

Each clinic has a unique subdomain (`<tenant>.klinika.health`). The subdomain is extracted from the request hostname by a NestJS middleware and attached to the request context as `request.clinicId`.

Every clinical table includes a `clinic_id` column. Postgres Row-Level Security policies on every table enforce that queries can only return rows where `clinic_id = current_setting('app.clinic_id')`. The application sets this setting at the start of every request via Prisma's connection-level configuration.

Defense in depth — three independent layers:
1. **UI layer:** components scoped to the current clinic context (set once on app load)
2. **API layer:** every endpoint passes through `ClinicScopeGuard` which validates the subdomain and sets `request.clinicId`; every service filters queries by `request.clinicId`
3. **Database layer:** RLS policies reject any query that returns rows from another clinic, regardless of application bugs

Platform admin queries that legitimately span clinics use a different database connection with elevated privileges, with each cross-tenant query explicitly commented.

## Consequences

**Pros:**
- Single database to operate, monitor, back up
- Code paths stay simple (one schema, one set of migrations)
- Cross-tenant features (e.g. platform-wide stats) are SQL queries, not federation
- RLS is the canonical "last line of defense" — even if application code has bugs, data can't leak
- Subdomain branding (each clinic sees their own URL) feels professional
- Migration to schema-per-tenant later is feasible if RLS performance becomes a bottleneck

**Cons:**
- RLS adds ~5-15% query overhead (acceptable at our scale)
- Application code must always set `app.clinic_id` correctly — bugs here are serious
- Subdomain provisioning requires DNS + TLS automation (Caddy handles this)
- Cross-clinic queries require explicit privilege escalation (intentional friction)

**Accepted trade-offs:**
- Some startup queries don't have a clinic context (e.g. tenant lookup by subdomain) — these run with elevated privileges
- DNS provisioning has a cold-start cost for new tenants (~5 minutes for cert issuance)
- We accept the RLS overhead for the safety guarantee

## Revisit when

- A single clinic has >1M patients or >50M visits (would warrant schema-per-tenant)
- Cross-tenant queries become a bottleneck for platform-wide analytics
- A regulator requires physically isolated databases (would force instance-per-tenant)
- RLS query overhead becomes a measurable performance problem

## Implementation notes

- Subdomain extracted from `Host` header by `ClinicResolutionMiddleware`
- `clinic_id` set via `SET LOCAL app.clinic_id = '<uuid>'` at request start
- RLS policy template per table:
  ```sql
  ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON patients
    USING (clinic_id = current_setting('app.clinic_id')::uuid);
  ```
- Platform admin connection uses a separate Postgres role with `BYPASSRLS`
- Tests cover the isolation explicitly: a test user in clinic A cannot read clinic B data via any endpoint
