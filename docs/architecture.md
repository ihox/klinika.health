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
