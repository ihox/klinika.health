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

## Boundary enforcement update (fix)

Date: 2026-05-14
Status: Accepted (supplements the original decision; does not supersede)

### The bug

The original implementation drew the platform-admin boundary at the `admin.klinika.health` subdomain. In practice the boundary leaked at three points:

1. `POST /api/auth/login` (the clinic login) accepted requests from any host. On apex (`klinika.health` / `localhost`) it returned a 403 `"Hyrja kërkon nëndomenin e klinikës."` — a different response from "wrong password", so the API confirmed for any caller whether their email belonged to a clinic.
2. `POST /api/admin/auth/login` returned a 403 `"Vetëm për administratorin e platformës."` on a tenant subdomain — again, a different response from "wrong password," confirming the admin surface existed somewhere else.
3. The Next.js app served `/admin/*` on every host. A clinic user typing `donetamed.klinika.health/admin` got the platform-admin shell, with the only thing stopping them being the API guard returning the 403 above.

A platform admin logging in from a clinic subdomain (or a clinic user from apex) therefore got an unambiguous "you're on the wrong host" signal — the boundary was a strong hint, not an enforcement.

### The fix

Three-layer defense, applied independently:

1. **API middleware (`ClinicResolutionMiddleware`)** classifies every request as one of `{platform, tenant, reserved, unknown}` from the Host header. Reserved subdomains (`admin`, `www`, `api`, `mail`, `support`, …) are rejected at the edge with `400 reserved_subdomain`. Unknown clinic subdomains (well-formed but no matching active clinic) return `404 clinic_not_found`. The legacy `admin.*` admin-host is gone; platform admins now live at the apex domain.

2. **API guards** (`AuthGuard`, `AdminAuthGuard`, `ClinicScopeGuard`) all return the SAME generic 401 (`"Email-i ose fjalëkalimi është i pasaktë."`) for wrong email, wrong password, wrong scope, wrong clinic, and copied-cross-host session cookies. Sessions are pinned to scope — a clinic session presented on apex (or vice versa) is rejected as if it didn't exist. The only non-generic responses are `clinic_suspended` (403) and `clinic_not_found` (404), both of which carry information the web layer legitimately needs to redirect correctly.

3. **Next.js middleware** (`apps/web/middleware.ts`) mirrors the API classification and rewrites cross-scope paths to a 404 page. Platform host visiting `/cilesimet|/doctor|/pacient` → 404. Tenant host visiting `/admin` → 404. Reserved host visiting anything → 404. The `/login` route is host-aware: apex renders the platform-admin form, tenant renders the clinic welcome card (with the clinic name pulled live from `GET /api/auth/clinic-identity`).

### The error-constancy property

The boundary's security guarantee is response-equivalence:

> For any credential-style failure — wrong email, wrong password, wrong scope, expired session, cross-host cookie reuse — the API returns `401` with the exact string `"Email-i ose fjalëkalimi është i pasaktë."` and no other identifying fields.

An attacker cannot observe whether an email exists in a different context. The Pino access log retains the distinction internally (via the `reason` column on `auth_login_attempts` and structured audit rows) so operators can still debug — the constancy applies to wire responses only.

### What changed in code

- `ctx.isAdminScope` → `ctx.isPlatform` everywhere. Semantic shift: was "admin.* subdomain," is now "apex domain."
- `@AdminScope()` decorator → `@PlatformScope()`.
- Cookie names unchanged (`klinika_session` clinic, `klinika_admin_session` platform admin).
- `https://admin.klinika.health` removed from CORS allow-list and the platform-admin setup email; both now point at the apex.
- New `GET /api/auth/clinic-identity` (anonymous, tenant scope only) returns `{ subdomain, name, shortName }` for the resolved host so the host-aware login page can render the right brand without bundling tenant data.
- Frontend `/admin/login` route deleted; the form moved to `components/auth/platform-admin-login-form.tsx` and renders from `/login` on apex.

### Test coverage

`apps/api/src/modules/auth/auth-boundary.integration.spec.ts` exercises every cell of the host × cookie × endpoint matrix, comparing actual response bodies character-by-character against the generic-invalid constant. `apps/web/tests/e2e/boundary.spec.ts` exercises the routing layer end-to-end: apex/tenant/reserved hosts × wrong-scope-path combinations.
