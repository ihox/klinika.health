# Klinika

Multi-tenant SaaS for pediatric clinics. Albanian UI. Kosovo jurisdiction.
First customer: DonetaMED (Prizren, Kosovo).

> Before contributing, read [`CLAUDE.md`](CLAUDE.md). It contains the
> non-negotiable rules, tech stack, and conventions for this codebase.

---

## Quick start

Prerequisites:

- Docker + Docker Compose
- Node.js 20.11+
- pnpm 9+
- Python 3.12 (for the migration tool only)

Bring up the full local stack (web, api, postgres, orthanc):

```bash
cp .env.example .env
pnpm install
make dev
```

Services:

- Web — http://localhost:3000
- API — http://localhost:3001/health
- Postgres — `postgres://klinika:klinika@localhost:5432/klinika`
- Orthanc (DICOM) — http://localhost:8042

Stop everything:

```bash
make stop
```

---

## Common commands

```bash
make dev            # Start all services
make stop           # Stop all services
make db-migrate     # Apply pending Prisma migrations
make db-reset       # Drop and recreate database (CAUTION)
make db-studio      # Open Prisma Studio
make lint           # ESLint across workspaces
make typecheck      # tsc --noEmit across workspaces
make test           # Vitest unit tests
make test-e2e       # Playwright E2E
```

See the full workflow reference in [`CLAUDE.md` §4](CLAUDE.md).

---

## Repository layout

```
apps/web/             Next.js 15 (App Router) frontend
apps/api/             NestJS 10 backend
tools/migrate/        Python Access → Postgres migration
infra/                Dockerfiles, Compose, Caddy templates
design-reference/     HTML prototype + design tokens (canonical UI source)
docs/                 Architecture, deployment, runbook, ADRs
.github/workflows/    CI/CD
```

The repo structure rationale lives in [ADR-001](docs/decisions/001-repo-structure.md).

---

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — rules, stack, patterns
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/decisions/`](docs/decisions/) — ADRs
- [`design-reference/prototype/`](design-reference/prototype/) — canonical UI
