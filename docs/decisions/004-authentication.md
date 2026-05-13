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
