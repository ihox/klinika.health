# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records — short documents capturing significant architectural decisions, their context, the options considered, and the rationale.

ADRs are **immutable once accepted**. If a decision changes, write a new ADR that supersedes the old one. Never edit an accepted ADR's substance — only its `Status` field to mark it as superseded.

## Format

Each ADR follows this structure:

```markdown
# ADR NNN: Title

Date: YYYY-MM-DD
Status: Accepted | Superseded by ADR-MMM | Deprecated

## Context

What problem are we solving? What constraints apply?

## Decision

What we chose, stated clearly.

## Consequences

What this enables (pros), what we accept (cons), and what we'd revisit.

## Revisit when

Triggers that would justify reopening this decision.
```

## Index

| # | Title | Status |
|---|---|---|
| 001 | [Repository structure](001-repo-structure.md) | Accepted |
| 002 | [Deployment topology](002-deployment-topology.md) | Accepted |
| 003 | [Background jobs](003-background-jobs.md) | Accepted |
| 004 | [Authentication](004-authentication.md) | Accepted |
| 005 | [Multi-tenancy](005-multi-tenancy.md) | Accepted |
| 006 | [Time zones](006-time-zones.md) | Accepted |
| 007 | [PDF generation](007-pdf-generation.md) | Accepted |
| 008 | [Soft delete with undo](008-soft-delete-undo.md) | Accepted |
| 009 | [DICOM storage](009-dicom-storage.md) | Accepted |
| 010 | [Migration approach](010-migration-approach.md) | Accepted (partially superseded by 012) |
| 011 | [Unified visit model](011-unified-visit-model.md) | Accepted |
| 012 | [Vizitat field-mapping correction](012-vizitat-field-mapping-correction.md) | Accepted |
| 013 | [Standalone clinical visits](013-standalone-visits.md) | Accepted |
| 014 | [Access reader uses mdb-json](014-access-reader-mdb-json.md) | Accepted |
| 015 | [DOB orphan policy + swap recovery + PASS criteria](015-dob-orphan-policy.md) | Accepted |
| 016 | [Payment-code mapping + Tjera preflight refinement](016-payment-code-and-preflight-refinement.md) | Accepted |

## Adding a new ADR

When making a significant architectural decision:
1. Copy the template from any existing ADR
2. Use the next sequential number (zero-padded to 3 digits)
3. Write the ADR in the same PR as the related code change
4. Update this index
5. After acceptance, never edit the substance — only the Status if superseded
