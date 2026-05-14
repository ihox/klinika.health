# ADR 004: Authentication with Better-Auth

Date: 2026-05-13
Status: Accepted

## Context

Klinika needs robust authentication for two distinct user populations:
- **Clinic users** (doctors, receptionists, clinic admins) — log in multiple times per day from known clinic devices
- **Platform admins** (founder) — log in occasionally from various locations to manage tenants

Requirements:
- Email + password (Argon2 hashing, min 10 chars, haveibeenpwned check)
- Email-based MFA on new devices for ALL users
- Trusted device cookie persisting 30 days
- Sessions stored server-side in Postgres
- Standard flows: login, logout, password reset, password change, "logout other sessions"
- Audit log integration

Options considered:
- **Lucia v3** — minimal, well-documented, sessions in Postgres
- **Better-Auth** — newer (2024), built-in MFA + trusted devices + organizations
- **Auth.js v5** (NextAuth successor) — mature, broad provider support
- **Keycloak** — enterprise-grade, overkill for our scale
- **Auth0 / Clerk** — SaaS, monthly cost, vendor lock-in
- **Custom from scratch** — high effort, high security risk

## Decision

Use **Better-Auth** as the authentication library.

Better-Auth provides built-in primitives for:
- Email/password with Argon2
- Email-based 2FA via the `twoFactor` plugin
- Trusted device management
- Session storage in Postgres
- Password reset flows
- Session revocation ("logout other sessions")

We rely on Better-Auth's defaults where possible and customize only:
- Email templates (Albanian, branded for Klinika)
- MFA UI (custom verification screen matching design)
- Audit log integration on auth events

The `users` table is scoped per clinic via a `clinic_id` foreign key. Platform admin users are in a separate `platform_admins` table with no `clinic_id`.

## Consequences

**Pros:**
- Significantly less custom auth code to write and maintain
- Built-in MFA + trusted devices match our requirements exactly
- Active maintenance, growing community
- Better TypeScript ergonomics than alternatives
- Sessions in Postgres = backups include session state automatically
- Email MFA via Resend integrates cleanly with existing email infrastructure

**Cons:**
- Newer library (2024) — less battle-tested than Lucia or Auth.js
- Less Claude Code training data for Better-Auth patterns (mitigated by explicit doc pointers in CLAUDE.md)
- Some Better-Auth APIs may change in early 2026 (we pin version explicitly)

**Accepted trade-offs:**
- We pin Better-Auth version to avoid surprise breakage
- We document Better-Auth patterns in CLAUDE.md and reference docs
- We accept the newer-library risk in exchange for built-in functionality

## Revisit when

- Better-Auth has a major breaking change we can't justify migrating to
- We need SSO / SAML for an enterprise customer (would add Better-Auth's OIDC plugins, or migrate to Keycloak)
- We need fine-grained device-fingerprinting beyond Better-Auth's defaults
- Better-Auth becomes unmaintained (unlikely, but the migration path to Lucia or rolling our own is well-understood)

## Implementation notes

- Sessions stored in `auth_sessions` table (managed by Better-Auth)
- Trusted devices in `auth_trusted_devices` table with 30-day TTL
- MFA codes in `auth_mfa_codes` table with 15-minute TTL
- Failed login attempts tracked for rate limiting (separate `auth_login_attempts` table)
- All auth events written to `audit_log` with appropriate action types (`auth.login.success`, `auth.login.failed`, `auth.mfa.sent`, `auth.mfa.verified`, `auth.password.changed`, `auth.device.trusted`, `auth.device.revoked`, `auth.sessions.revoked`)

## Multi-role update

Date: 2026-05-14
Status: Accepted (supplements the original decision; does not supersede)

### The change

`users.role` (single `user_role` enum) → `users.roles` (`TEXT[]`).

Authorization moves from a single-value equality check (`ctx.role === 'doctor'`) to array membership (`ctx.roles.includes('doctor')`). The `@Roles(...)` decorator keeps its signature; it now passes when the caller holds at least one of the listed roles (OR semantics).

### Why

The original single-role model forced an artificial separation that did not match how small clinics actually staff themselves. At DonetaMED, Dr. Taulant Shala is both the doctor AND the clinic administrator — not two separate accounts. With a single-role enum he would have needed two emails and two logins, or one of those responsibilities would have been silently delegated to a fictional second user. The TEXT[] model lets any combination of the three clinic roles attach to one account; the DB CHECK constraints (`cardinality between 1 and 3`, `roles ⊆ {doctor, receptionist, clinic_admin}`) keep the surface bounded.

### Canonical role labels (Albanian, single source of truth)

The labels live in `apps/web/lib/role-labels.ts` and are used by every chip, table, dropdown, and audit-log diff in the clinic surface:

- `doctor` → **Mjeku**
- `receptionist` → **Recepsioniste**
- `clinic_admin` → **Administrator i klinikës**

The email-template wording (`mjek`, `recepsioniste`, `administrator i klinikës`) is intentionally a separate lowercase indefinite form that fits the sentence "ju ka shtuar si …"; the constants in `lib/role-labels.ts` are the user-facing chip / table labels.

### Canonical role → menu mapping

- `receptionist` grants: **Kalendari** (/receptionist)
- `doctor` grants: **Pamja e ditës** (/doctor) + **Pacientët** (/pacientet)
- `clinic_admin` grants: **Cilësimet** (/cilesimet)

A user sees the UNION of items their roles grant; display order is fixed (Kalendari, Pamja e ditës, Pacientët, Cilësimet) regardless of which roles produced which items. The mapping lives in `apps/web/components/clinic-top-nav.tsx`.

### Login redirect priority

After successful login + MFA, `homePathForRoles` chooses the landing route as:

1. `platform_admin` → `/admin`
2. `doctor` → `/doctor`
3. `clinic_admin` → `/cilesimet`
4. `receptionist` → `/receptionist`
5. (degenerate / empty roles) → `/profili-im`

So a user with `['receptionist', 'clinic_admin']` lands on `/cilesimet` (admin beats receptionist); a user with `['doctor', 'clinic_admin']` lands on `/doctor` (doctor beats admin); a user with only `['receptionist']` lands on `/receptionist`.

### Receptionist privacy boundary update

Before this refactor, the boundary was `ctx.role === 'receptionist'`. With multiple roles per user the rule becomes:

> A user gets the redacted PatientPublicDto **only when** they have the `receptionist` role AND lack both `doctor` and `clinic_admin`.

Anyone with clinical access sees the full record, even if they also hold the receptionist role. The helper `isReceptionistOnly()` in `apps/api/src/common/request-context/role-helpers.ts` is the single point of truth; the `patients.service.ts`, `patient-chart.service.ts`, and patient controller all defer to it.

### Within-scope 403

A user navigating to a route they don't have a role for (e.g. a receptionist typing `/cilesimet`) lands on the `/forbidden` empty-state page. The `RouteGate` component (`apps/web/components/route-gate.tsx`) wraps every gated page. This is distinct from the cross-scope 404 (apex hitting `/cilesimet`, tenant hitting `/admin`) which is handled by the Next.js middleware — see ADR-005 "Boundary enforcement update".

### What changed in code (high-level)

- `users.role` (enum `user_role`) → `users.roles` (`TEXT[]`); enum dropped from Postgres.
- `RequestContext.role` → `RequestContext.roles: AppRole[] | null`.
- `RolesGuard` uses `required.some(r => ctx.roles.includes(r))`.
- `/api/auth/login`, `/api/auth/mfa/verify`, `/api/auth/me` wire shapes return `roles: string[]` (was `role: string`).
- `/api/clinic/users` CreateUser / UpdateUser DTOs accept `roles: ClinicRole[]` (≥1, ≤3, unique).
- Audit log `roles` field diffs render as RoleChip arrays in the clinic-settings audit tab.
- Seeded users: Dr. Taulant has `['doctor', 'clinic_admin']`; Erëblirë has `['receptionist']`. No dummy separate clinic_admin account.
- New web routes: `/pacientet` (role-aware wrapper redirecting clinical users to `/doctor/pacientet`), `/pamja-e-dites` (alias that redirects doctors to `/doctor`).
- Shared `ClinicTopNav` (`apps/web/components/clinic-top-nav.tsx`) is now rendered on every clinic surface and filters nav items by the user's roles.
