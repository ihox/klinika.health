# ADR 001: Repository structure

Date: 2026-05-13
Status: Accepted

## Context

Klinika is a multi-tenant SaaS with a web frontend (Next.js), an API backend (NestJS), a migration tool (Python), infrastructure code, documentation, and design references. The team is small (founder solo, optionally a contractor later). We need a project structure that's predictable for Claude Code, easy to onboard developers, and doesn't add tooling overhead disproportionate to the team size.

Options considered:
- **pnpm + Turborepo monorepo** — popular, sophisticated dependency caching, shared TypeScript types
- **Nx monorepo** — heavier, more opinionated, code generators built in
- **Single repo, multi-folder, no monorepo tooling** — plain pnpm workspaces or even no workspaces
- **Polyrepo** — separate Git repos per app

## Decision

Single repository, multi-folder, **no monorepo tooling**. pnpm workspaces for package management only. Top-level folders: `apps/web/`, `apps/api/`, `tools/migrate/`, `infra/`, `design-reference/`, `docs/`, `.github/workflows/`.

Shared code lives within `apps/api/` (validation schemas, types) and is imported by `apps/web/` via TypeScript path aliases. No `packages/` directory.

## Consequences

**Pros:**
- Zero monorepo-tooling learning curve
- Plain pnpm commands work everywhere (`pnpm install`, `pnpm run dev`)
- Claude Code navigates simple folder structures more reliably than Turborepo's task graphs
- CI is straightforward (no remote caching to configure)
- One developer can hold the entire structure in their head

**Cons:**
- No automatic task orchestration (`turbo run build` doesn't exist; we use a Makefile or simple scripts)
- No build caching across CI runs (acceptable: builds are fast at our scale)
- Cross-app refactors require more manual coordination
- If we grow to >5 apps, we'll outgrow this and need to migrate to Turborepo or Nx

**Accepted trade-offs:**
- Slightly slower local rebuilds compared to Turborepo's incremental builds
- Manual coordination of versions across apps (we accept this since both apps deploy together)

## Revisit when

- Team grows beyond 3-4 developers actively working in parallel
- We add a 4th or 5th distinct application (beyond web + api + migrate)
- Build times in CI exceed 5 minutes consistently
- Cross-app refactor friction becomes painful in practice

If we ever migrate, Turborepo is the likely target — its abstractions match our existing pnpm-workspace layout most closely.
