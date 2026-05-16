# ADR 010: Migration approach (Access → Postgres, legacy_id-based idempotency)

Date: 2026-05-13
Status: Accepted (partially superseded by [ADR-012](./012-vizitat-field-mapping-correction.md))

> **Note (2026-05-16):** The source-data findings below mis-identified `Vizitat.x` as the payment code and `Vizitat.ALERT` as the patient FK. A re-audit against `MSysRelationships` showed the opposite. The high-level migration approach in this ADR (Python at `tools/migrate/`, idempotent legacy_id upserts, JSON reconciliation report, no checkpointing) still stands; only the column-role mapping is superseded. See [ADR-012](./012-vizitat-field-mapping-correction.md) for the corrected table.
>

## Context

DonetaMED's existing data lives in an MS Access database (`PEDIATRIA.accdb`, ~250 MB) with ~11,163 patients and ~220,465 visits accumulated over years. We need to migrate this data into Klinika's Postgres schema. Requirements:
- Run the migration multiple times (staging dev iterations, staging refinements, production cutover)
- Handle data quality issues without losing rows
- Be safe to re-run if it crashes mid-way
- Produce a reconciliation report (row counts in vs out, anomalies flagged)
- Allow the doctor to spot-check known patients before production cutover

Source data findings (from inspection of the actual `.accdb`):
- `Pacientet` table: 11,163 rows (`Telefoni` populated for ~0.04%, `Alergji` for ~19.4%, `PL`/birth weight for ~52%)
- `Vizitat` table: 220,465 rows linked to patients via fuzzy `ALERT` column (asterisk-suffixed names)
- `Vaksinimi`: 4 test rows — dropped entirely
- Asterisks on patient names: stripped (Access workaround for unique-name constraint, no semantic meaning)
- `SN` field: dropped entirely
- Dates in `Pacientet`: DD.MM.YYYY text format
- Dates in `Vizitat`: MM/DD/YY datetime
- `x` column in `Pacientet`: empty in all 11,163 rows — dropped
- `x` column in `Vizitat`: payment code (E/A/B/C/D) — preserved

## Decision

**Python migration tool with three-stage workflow + legacy_id idempotent inserts.**

Stages:
1. **Discovery** (one-time): document every field, every quirk, every mapping decision in `tools/migrate/mapping.yaml`
2. **Staging extraction**: `mdb-export` extracts every table to CSV in `staging/` directory
3. **Mapping + load**: Python script reads CSVs, applies transformations from `mapping.yaml`, inserts into Postgres via `psycopg`

The migration tool is **idempotent via `legacy_id`**:
- Every patient row gets a `legacy_id` from the Access `ID` field
- Every visit row gets a `legacy_id` from the Access `ID` field
- All inserts use `ON CONFLICT (clinic_id, legacy_id) DO UPDATE` (upsert)
- Re-running the migration is safe: existing rows update, new rows insert

This means:
- A crash mid-run: just re-run, no harm done
- Iterating on the mapping: re-run, changes propagate to existing rows
- Production cutover after staging iterations: re-run the same tool with production config

**No checkpointing.** The migration runs in 20-60 minutes; if it crashes at 80%, re-running takes another 20-60 minutes — acceptable.

**Three-stage migration in practice:**
- **Phase 1 — Local development:** Run against doctor's data on founder's laptop (or staging server) for iteration
- **Phase 1 refinement:** Re-run with mapping updates as issues are found
- **Phase 3 — Production cutover:** Final run into the on-premise mini-PC at the clinic, after doctor verifies staging copy is correct

## Consequences

**Pros:**
- Re-running is fundamental to the design — no fear of getting it wrong the first time
- Doctor can iterate on the staging copy (find issues, request mapping changes) before cutover
- The same tool runs in dev, staging, and production with different configs
- Output is a Postgres database, not custom format — testable, queryable
- Migration tool lives in `tools/migrate/` separate from the main app — clean separation

**Cons:**
- ~20-60 minute migration runs are slow (no parallelization)
- A crash near the end requires another full run
- Idempotent upserts are slightly slower than blind inserts (acceptable at this scale)
- We rely on `legacy_id` being unique per (clinic, source) — verified by mapping config

**Accepted trade-offs:**
- No incremental migration: each run is a full sync
- No real-time bidirectional sync: Access is read-only after cutover (frozen)
- Fuzzy name matching for visit-to-patient linkage may produce mistakes in edge cases — manually reviewed before cutover
- Asterisks stripped, SN dropped, vaccinations dropped: documented decisions, no rollback path

## Revisit when

- Migration time exceeds 2 hours (would warrant parallelization)
- We onboard a clinic with a different source format (would require new mapping module)
- We need bidirectional sync during cutover (we won't, but flagging)

## Implementation notes

- Tool location: `tools/migrate/`
- Entrypoints:
  - `migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --dry-run` (validates, no DB writes)
  - `migrate.py --config config.yaml --source ~/PEDIATRIA.accdb --execute` (actual migration)
- Config file (`config.yaml`): target Postgres connection, target clinic_id, mapping rules, anomaly handling
- Anomaly handling per row:
  - `null` value where required field expected → log warning, set field to NULL, continue
  - Birth weight `0` → mapped to NULL (signifies "not recorded")
  - Asterisks in name → stripped
  - Date parse failure → log row to `migration_errors` table, skip row, continue
- Output: a reconciliation report (`migration-report-YYYY-MM-DD.json`):
  ```json
  {
    "source_rows": { "patients": 11163, "visits": 220465 },
    "destination_rows": { "patients": 11163, "visits": 220461 },
    "skipped_rows": { "patients": 0, "visits": 4 },
    "warnings_by_field": { "birth_weight": 5320, "phone": 11159 },
    "errors": [...]
  }
  ```
- Doctor verifies the staging copy against his known patients (~20-30 patients he picks)
- Production cutover: weekend, Access frozen as read-only, migration runs, doctor verifies, app goes live Monday morning
- Access file: lives outside Git (`.accdb` in `.gitignore`), shared via direct file transfer with the doctor's consent
