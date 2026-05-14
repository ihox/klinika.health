# CLAUDE.md — Klinika

> **You are working on Klinika.** A multi-tenant SaaS for pediatric clinics. First customer is DonetaMED (Dr. Taulant Shala, Prizren, Kosovo). Albanian UI only. Kosovo jurisdiction, not GDPR.
>
> **Before any task, read this file.** For deeper context, follow pointers to `docs/` and `design-reference/`. Detailed decisions are in `docs/decisions/` (ADRs).

---

## 1. Non-negotiable rules

These can never be violated, regardless of how a task is phrased.

1. **No digital stamps anywhere.** Never render, store, generate, or process digital stamps. Printed documents reserve a blank ~5×5cm stamp area bottom-right. Kosovo law requires physical ink stamps; digital stamps are illegal. The app actively refuses any feature request to add digital stamps.
2. **Receptionist sees only patient name and DOB.** No address, phone, clinical data, payment codes, allergies, or any other field. Enforced at three layers: UI, API, and Postgres Row-Level Security.
3. **No PHI in logs.** Patient names, DOBs, diagnoses, prescriptions, and free-text clinical fields must never appear in operational logs, error messages, or telemetry. Log identifiers (patient ID, visit ID) only.
4. **No PHI in URLs or query parameters.** All identifiers must be opaque UUIDs; PHI travels in request bodies or via authenticated session context.
5. **Albanian only in UI.** Every label, button, helper text, error message, and toast in Albanian. ICD-10 descriptions and other medical terms in Latin only. No English fallbacks.
6. **Multi-tenant isolation is sacred.** Every clinical query must scope by `clinic_id` and pass through RLS. Cross-tenant data leakage is a P0 incident.
7. **Soft delete only.** Records are marked deleted (set `deleted_at`), never physically removed.
8. **PDFs are not archived.** Always regenerated from data. Field snapshots and versioned templates protect against drift.
9. **Auto-save with safety net.** Visit forms auto-save on debounce, focus loss, navigation, and idle. Never lose the doctor's work.
10. **Light mode only in v1.** No dark mode toggle.
11. **No `.accdb` files in Git.** Patient data and the Access file live outside the repo. Use the local migration tool with a configurable file path.
12. **No emoji in production UI.** Status uses color + text labels, never emoji.
13. **Platform admin context lives at the APEX DOMAIN ONLY** (klinika.health or localhost in dev). Clinic users live at CLINIC SUBDOMAINS ONLY (donetamed.klinika.health, etc.). The two contexts never mix. Sessions, login pages, admin routes, and API queries are all scoped by this boundary. Enforced at middleware, API, and routing layers.

---

## 2. Tech stack (pinned versions, do not deviate)

**Frontend**
- Next.js 15 (App Router)
- React 19
- TypeScript 5.x (strict mode, no `any`)
- Tailwind CSS 3.x + shadcn/ui (Radix primitives)
- TanStack Query v5 (server state)
- Zustand (light client state)
- react-hook-form + Zod (forms and validation)
- date-fns + date-fns-tz (Europe/Belgrade everywhere)
- Recharts (WHO growth charts)
- Inter + Inter Display fonts

**Backend**
- NestJS 10.x + TypeScript strict
- Prisma 5.x (ORM and migrations)
- PostgreSQL 16
- Better-Auth (email/password, email MFA, trusted devices, sessions in Postgres)
- Pino (structured logging)
- Puppeteer (server-side PDF)
- pg-boss (background jobs, Postgres-backed, no Redis)

**Email**
- Resend (platform default)
- Per-clinic SMTP override (encrypted credentials at rest)

**DICOM**
- Orthanc (Docker container)
- Custom NestJS module proxies authenticated image access

**Infrastructure**
- Docker + Docker Compose (local + production)
- Caddy (reverse proxy, auto-TLS via Let's Encrypt DNS challenge)
- Ubuntu LTS 24.04
- GitHub Actions CI/CD
- GitHub Container Registry (GHCR)
- Cloudflare Tunnel (on-premise installs)
- Cloudflare Access (staging + admin gate)
- Backblaze B2 (encrypted backups via restic)
- Tailscale (admin SSH access)

**Dev tooling**
- pnpm (package manager, single workspace)
- Vitest (unit tests)
- Playwright (E2E tests)
- ESLint + Prettier (Biome optional alternative)
- Husky + lint-staged (pre-commit)

**Migration**
- Python 3.12 standalone tool
- mdbtools (extract Access tables)
- pandas (profiling and transformation)
- psycopg (load into Postgres)

**Deliberately NOT used:** Redis, Temporal, BullMQ, Keycloak, Lucia, Auth.js, FHIR servers (Medplum/HAPI), Kubernetes, Turborepo, Nx, Sentry (v1), Vercel.

---

## 3. Folder structure

Single repo, multi-folder, no monorepo tooling.

```
klinika/
├── apps/
│   ├── web/                    # Next.js 15 app
│   │   ├── app/                # App Router routes
│   │   ├── components/         # React components
│   │   ├── lib/                # Utilities, hooks, API client
│   │   └── package.json
│   └── api/                    # NestJS API
│       ├── src/
│       │   ├── modules/        # Feature modules (auth, patients, visits, etc.)
│       │   ├── common/         # Decorators, guards, filters
│       │   ├── prisma/         # Prisma client + schema
│       │   └── main.ts
│       └── package.json
├── tools/
│   └── migrate/                # Python Access → Postgres migration
│       ├── migrate.py
│       ├── config.yaml
│       └── requirements.txt
├── infra/
│   ├── docker/                 # Dockerfiles
│   ├── compose/                # Docker Compose files (dev, staging, prod, on-prem)
│   └── caddy/                  # Caddyfile templates
├── design-reference/
│   ├── prototype/              # HTML prototype from Claude Design
│   └── tokens/                 # design-tokens.css, .json, tailwind.config.js
├── docs/
│   ├── README.md               # Project overview (also at repo root)
│   ├── architecture.md         # System architecture
│   ├── deployment.md           # Cloud + on-premise deploy procedures
│   ├── runbook.md              # Operational procedures
│   ├── data-migration.md       # Access migration tool details
│   ├── contributing.md         # Codebase conventions
│   └── decisions/              # ADRs
│       ├── README.md
│       ├── 001-repo-structure.md
│       ├── 002-deployment-topology.md
│       └── ...
├── .github/
│   └── workflows/              # CI + deploy
├── .env.example                # Template, no secrets
├── .gitignore                  # Includes .env, .accdb, /storage/
├── Makefile                    # Convenience commands
├── pnpm-workspace.yaml         # Workspace definition
├── package.json                # Root package
└── CLAUDE.md                   # This file
```

**Key conventions:**
- Each feature lives in one NestJS module: `apps/api/src/modules/<feature>/`.
- Database schema lives in `apps/api/prisma/schema.prisma`.
- Shared types between frontend and backend: defined in `apps/api/src/modules/<feature>/<feature>.dto.ts` (Zod schemas), imported by frontend via a local TypeScript path alias.
- No `packages/` directory. Shared code lives in `apps/api/lib/` and is imported via TypeScript path aliases.

---

## 4. Critical workflows

```bash
# Local dev
make dev                        # Start all services (web, api, postgres, orthanc)
make stop                       # Stop all services

# Database
make db-migrate                 # Run pending Prisma migrations
make db-seed                    # Seed dev database
make db-reset                   # Drop and recreate (CAUTION)
make db-studio                  # Open Prisma Studio

# Testing
pnpm test                       # Run Vitest unit tests
pnpm test:e2e                   # Run Playwright E2E
pnpm test:e2e:headed            # E2E with browser visible (for debugging)

# Linting / Typechecking
pnpm lint                       # ESLint
pnpm typecheck                  # tsc --noEmit
pnpm format                     # Prettier

# Migration tool (run from tools/migrate/)
python migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --dry-run
python migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --execute

# Admin bootstrap (run once per install)
pnpm cli admin:create --email you@klinika.health
# Prints temporary password; user changes on first login

# Deploy (CI)
git tag v0.1.0 && git push --tags          # Triggers production deploy
git push origin main                       # Triggers staging deploy
```

---

## 5. Required patterns

### 5.1 API endpoints

Every endpoint that touches clinical data:

```typescript
@Controller('visits')
@UseGuards(AuthGuard, ClinicScopeGuard)        // Both required
export class VisitsController {
  @Post()
  @Roles('doctor')                              // Explicit role
  @AuditLog('visit.created')                    // Audit log decorator
  async create(@Body() dto: CreateVisitDto, @Ctx() ctx: RequestContext) {
    // Service receives ctx.clinicId, never resolves clinic from body
    return this.visits.create(dto, ctx);
  }
}
```

The `ClinicScopeGuard` sets `request.clinicId` from the subdomain (`donetamed.klinika.health` → `donetamed`). Services must always filter by `request.clinicId`. RLS provides a second layer.

### 5.2 Database queries

```typescript
// ✅ Correct — scoped by clinicId, falls under RLS
await this.prisma.patient.findMany({
  where: { clinicId: ctx.clinicId, deletedAt: null }
});

// ❌ Forbidden — unscoped query
await this.prisma.patient.findMany();
```

RLS policies enforce this at the database layer. If you ever need to bypass scoping (platform admin queries across clinics), use an explicit `prisma.$queryRaw` with a comment explaining why.

### 5.3 Audit log

Every mutation on clinical or sensitive data writes an audit row:

```typescript
{
  clinicId,
  userId,
  action: 'visit.updated',        // verb.entity format
  resourceType: 'visit',
  resourceId: visit.id,
  changes: [                        // JSONB array of field diffs
    { field: 'diagnosis', old: '...', new: '...' },
    { field: 'prescription', old: '...', new: '...' }
  ],
  ipAddress,
  userAgent,
  sessionId,
  timestamp
}
```

Successive saves of the same record by the same user within 60 seconds **coalesce** into a single audit row (updated in place). Sensitive reads (chart open, document print, vërtetim issue, auth events) write audit rows with `changes: null`.

### 5.4 Auto-save (visit forms only)

Visit forms auto-save on these triggers:
- 1.5 second debounce after the last keystroke
- Field blur (focus loss)
- Navigation (Next.js route change)
- Save button click (immediate)
- 30 seconds of idle time
- `beforeunload` (best-effort, synchronous fetch with keepalive)

State indicator visible at all times: `Idle`, `Dirty`, `Saving`, `Saved`, `Error`.

On save failure: show a dialog listing unsaved fields. Maintain a local IndexedDB backup until the next successful save. Never silently lose work.

### 5.5 Soft delete + 30s undo

User clicks delete → record gets `deletedAt = now()` → 30-second toast appears with "Anulo" button → clicking restores `deletedAt = null`. No confirmation modal needed; the undo is the safety net.

After 30 seconds without undo, the toast dismisses. The record stays soft-deleted (never hard-deleted in v1). Platform admin has a CLI tool to purge soft-deleted records older than N days if needed.

Soft-deleted rows are hidden from normal queries by default. Restore endpoints and platform-admin-only purge tools must pass `deletedAt` explicitly at the top level of the WHERE clause — the middleware detects this and skips its default deleted-row filter (and emits a Pino warning so accidental bypasses stay visible). Only top-level `deletedAt` is inspected; filters nested inside `AND`/`OR`/`NOT` are not auto-detected.

### 5.6 Time zones

All timestamps stored as `TIMESTAMPTZ` in UTC. All UI display in `Europe/Belgrade`. All containers and OS run on `Europe/Belgrade` system time. Use `date-fns-tz` for any conversion. Never use the host's default time zone.

### 5.7 OS-aware keyboard shortcuts

Centralize OS detection in one utility:

```typescript
export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const modKey = isMac ? 'metaKey' : 'ctrlKey';
export const modKeyDisplay = isMac ? '⌘' : 'Ctrl';
```

Every shortcut handler uses this. Every tooltip and shortcut display calls `formatShortcut(action)` which returns the correct symbol per OS. Never hardcode `Cmd+S` or `Ctrl+S` anywhere.

### 5.8 Role checks

Users have a `roles TEXT[]` column with values from `{ doctor, receptionist, clinic_admin }`. The schema enforces at the DB level: `cardinality(roles) BETWEEN 1 AND 3` and `roles <@ ARRAY['doctor', 'receptionist', 'clinic_admin']`. Application code never reads a single-role field — all authorization is array membership: `user.roles.includes('doctor')`.

The `@Roles(...)` decorator accepts multiple roles with **OR semantics**: `@Roles('doctor', 'clinic_admin')` passes when the caller holds at least one of those roles. `ctx.roles` for clinic sessions is the user's `users.roles` array; for admin sessions the guard sets it to `['platform_admin']`. Two helpers live at `apps/api/src/common/request-context/role-helpers.ts`:

- `hasClinicalAccess(roles)` — true iff the user has `doctor` or `clinic_admin`. Use this everywhere the old `ctx.role === 'doctor' || ctx.role === 'clinic_admin'` appeared.
- `isReceptionistOnly(roles)` — true iff the user has `receptionist` AND lacks both `doctor` and `clinic_admin`. The receptionist privacy boundary (§1.2) triggers ONLY on this predicate — anyone with clinical access sees full patient data, even if they also hold the receptionist role.

**Canonical role labels (Albanian, single source of truth in `apps/web/lib/role-labels.ts`):**
- `doctor` → "Mjeku"
- `receptionist` → "Recepsioniste"
- `clinic_admin` → "Administrator i klinikës"

**Canonical role → menu mapping** (`apps/web/components/clinic-top-nav.tsx`):
- `receptionist` grants: Kalendari
- `doctor` grants: Pamja e ditës, Pacientët
- `clinic_admin` grants: Cilësimet

A user sees the UNION of items their roles grant. Display order left-to-right: Kalendari, Pamja e ditës, Pacientët, Cilësimet.

**Login redirect priority** (`homePathForRoles`): doctor > clinic_admin > receptionist > /profili-im (degenerate). Platform admins always go to /admin (separate auth path, unaffected). The smoke-test cell "Erëblirë (receptionist + clinic_admin) lands on /cilesimet" follows from this priority.

**Within-scope 403**: a user navigating to a route their role doesn't grant lands on `/forbidden` (the `RouteGate` component wraps gated pages). The cross-scope 404 (apex hitting `/cilesimet`, tenant hitting `/admin`) is unchanged — that's middleware-level (ADR-005).

---

## 6. Forbidden patterns

- ❌ Direct Prisma calls from controllers (always go through a service)
- ❌ Raw SQL outside Prisma migrations or explicit `$queryRaw` (with a comment)
- ❌ `any` in TypeScript (use `unknown` + type narrowing if necessary)
- ❌ PHI in console.log, structured logs, or error messages
- ❌ PHI in URL parameters or query strings
- ❌ Storing patient data in localStorage or sessionStorage
- ❌ `console.log` in production code (use the Pino logger)
- ❌ Inline styles or styled-components (Tailwind classes only)
- ❌ External CDN scripts (everything bundled or self-hosted)
- ❌ Reading environment variables outside the config module
- ❌ Date math without `date-fns` and `date-fns-tz`
- ❌ Hardcoded clinic names, phone numbers, or DonetaMED-specific content
- ❌ Bypassing the audit log decorator on mutations
- ❌ Catching errors silently — every error must be logged or rethrown

---

## 7. Logging discipline

```typescript
// ✅ Correct
logger.info({ patientId, visitId, clinicId, userId }, 'Visit saved');

// ❌ Forbidden — exposes patient name
logger.info(`Visit saved for ${patient.firstName} ${patient.lastName}`);

// ❌ Forbidden — diagnosis is PHI
logger.warn({ diagnosis: visit.diagnosis }, 'Slow query');

// ✅ Correct — log identifiers, not contents
logger.warn({ visitId, queryDurationMs }, 'Slow visit save');
```

Structured JSON output. Pino redaction configured for any field that might contain PHI as a defense in depth (`firstName`, `lastName`, `diagnosis`, `prescription`, `notes`, `complaint`, etc.).

Request ID propagated from frontend (`x-request-id` header) through every log line for correlation.

---

## 8. Test strategy

Pragmatic: rigorous where it matters, light where it doesn't.

**Required tests (must exist, must pass in CI):**
- Auth flows: login, MFA verification, trusted device, password change
- RBAC: receptionist cannot access patient chart, doctor cannot access /admin, platform admin scope
- Multi-tenant isolation: clinic A user cannot read clinic B data
- Migration: input → output mapping with sample data, idempotency
- Audit log: writes happen on every mutation, coalescing works
- Payment code calculations
- Date utilities (especially around Europe/Belgrade DST transitions)
- Top 10 E2E flows: login + MFA, book appointment (both paths), create visit, print visit, issue vërtetim, link DICOM, soft delete + undo, search patient, complete day workflow

**Light testing:**
- UI components — render tests for the trickier ones (calendar grid, ICD-10 multi-select, autocomplete)
- Edge case branches in services — covered organically as written

**Not enforced:**
- Coverage percentages
- Snapshot tests
- Performance benchmarks

**Tools:** Vitest for unit + integration. Playwright for E2E. MSW for API mocking in component tests.

---

## 9. Rate limiting and CORS

**Rate limiting (pg-based, in NestJS middleware):**
- `POST /auth/login` — 5/min per IP, 10/hour per email
- `POST /auth/mfa/send` — 3/min per email
- `POST /auth/mfa/verify` — 5/min per session
- General authenticated API — 100/min per user
- Public/anonymous endpoints — 30/min per IP

Backed by Postgres (`rate_limits` table). Cloudflare Rate Limiting as a second layer (free tier on klinika.health).

**CORS policy:**
- API allows requests from `https://*.klinika.health` and `https://klinika.health` only
- No wildcard `*`
- Credentials allowed (for session cookies)
- Methods: `GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Cloudflare-Tunnel-routed requests from clinic LANs work transparently

---

## 10. Design reference

The HTML prototype in `design-reference/prototype/` is the **canonical source of truth for layout, styling, and Albanian copy**.

**Workflow when building any UI component:**
1. Open the relevant HTML file (e.g. `design-reference/prototype/chart.html`)
2. Identify the structure, Tailwind classes, and Albanian strings
3. Translate to React components matching the structure
4. Use design tokens from `design-reference/tokens/tailwind.config.js`
5. Re-check against the prototype before considering the component done

If the prototype is ambiguous on a specific behavior (animation timing, hover state, etc.), default to the most reasonable senior-engineer interpretation and add a brief comment noting the assumption.

The Albanian strings in the prototype are the canonical source. Do not invent new strings; if a string is missing, add it to `docs/strings.md` and use that.

### components/ subfolder
The prototype now has two layers:
- Top-level files (chart.html, doctor.html, etc.) — full screens in context
- components/ subfolder — isolated component references for modals, toasts,
  dialogs, and states

Files in components/: clinic-login, password-reset, mfa-verify,
edit-history-modal, dicom-lightbox, dicom-picker, vertetim-dialog,
growth-chart-modal, toast-undo, save-failure-dialog, empty-states,
loading-skeletons, connection-status.

When building a UI piece that has a components/ reference, use it as the
primary source of truth for that specific piece.

---

## 11. Documentation maintenance

When implementing a feature, update relevant docs in the same PR:
- New deployment step → update `docs/deployment.md`
- ADR-worthy decision → create a new ADR in `docs/decisions/`
- New module or significant API change → update `docs/architecture.md`
- Operational procedure → update `docs/runbook.md`

ADRs are immutable once accepted. Superseding decisions get a new ADR with `Status: Supersedes ADR-NNN`.

---

## 12. Build slice approach

Work proceeds in **vertical slices**, not horizontal layers. A slice is a complete, working feature touching all layers (DB, API, UI, tests). The slice sequence is documented in `docs/slice-plan.md` and updated as work progresses.

**Slice principles:**
- Each slice ends with working code committed to a branch
- Each slice has at least one E2E test if it's a user-facing flow
- No slice introduces a feature without its associated docs/ADR updates
- Slices are small enough to fit in one focused Claude Code session (~2-4 hours)

---

## 13. Pointers for deeper context

- `docs/architecture.md` — system architecture, data flow, module boundaries
- `docs/deployment.md` — cloud + on-premise deploy procedures
- `docs/runbook.md` — operational procedures and incident response
- `docs/data-migration.md` — Access → Postgres migration tool
- `docs/contributing.md` — codebase conventions and PR workflow
- `docs/decisions/` — ADRs for major decisions
- `design-reference/prototype/` — canonical UI reference (HTML)
- `design-reference/tokens/` — design tokens (CSS, JSON, Tailwind config)

For questions about decisions, read the relevant ADR. For questions about how something looks, read the HTML prototype. For questions about how to deploy, read `deployment.md`. For all else, this file.

---

## 14. Project context summary

- **Customer #1:** DonetaMED, Prizren, Kosovo. Dr. Taulant Shala (pediatër). Phones 045 83 00 83, 043 543 123. Hours 10:00–18:00.
- **Patient base:** ~11,163 patients migrating from MS Access (~220,465 visits).
- **Future:** v2 includes AI features (clinical summarization, smarter autocomplete), MWL DICOM integration, appointment reminders. Schema designed to support these without breaking changes.
- **Audience:** doctors and receptionists at small pediatric clinics in the Balkans. UI must be friendly, dense, professional, never childish.

The doctor's daily workflow is the highest priority. Anything that frustrates Dr. Shala in 30 visits/day is wrong. Anything that protects child patient data is right.
