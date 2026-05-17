# ADR 015: DOB orphan policy + Vendi↔Datelindja swap recovery + revised PASS criteria

Date: 2026-05-17
Status: Accepted — orphan rule superseded by [ADR-017](./017-import-incomplete-dob-with-sentinel.md); swap recovery and reconciliation carve-out still in effect

> **Note (same day):** The "orphan unparseable-DOB rows" decision below was reversed by [ADR-017](./017-import-incomplete-dob-with-sentinel.md) once we realised Klinika already had an established `UNKNOWN_DOB_SENTINEL` (`1900-01-01`) convention for incomplete patients (used by the receptionist quick-add path and the `isPatientComplete` predicate). Those rows now import with the sentinel and surface in the UI's existing completion queue. The Vendi↔Datelindja swap detection and the reconciliation verdict carve-out described here remain in force.

## Context

Slice 17 STEP 6 (dry-run against the real `PEDIATRIA.accdb`) showed 561 of 11,163 patient rows (5.03%) failing DOB parse. Under the original ADR-010 + ADR-012 policy these all became orphans with a single reason code (`dob_unparseable`), which pushed the reconciliation verdict into FAIL because the orphan-rate threshold is 2% (set in `reconciliation.py`).

Categorising the 561 by source-data shape gave a clear picture:

| Shape                                                | Count | Share |
|------------------------------------------------------|------:|------:|
| Year-only DOB (`Datelindja="2018"`)                  |   415 |  74%  |
| Other typos (`"08..02.2023"`, `"21 vjeq"`, missing digit) |    85 |  15%  |
| Datelindja field absent / blank                      |    58 |  10%  |
| Vendi↔Datelindja swap (`Datelindja="Prizren"`, `Vendi="02.11.2021"`) |     3 |   <1% |

The first and third buckets are clinically *unrecoverable*: a pediatric chart with no month/day cannot drive growth charts, age-based dosing, vaccinations, or developmental milestones. The decision to orphan them is the right call (Dr. Taulant manually re-enters from family records post-cutover) — but with these orphans counting against the 2% threshold the reconciliation verdict is permanently FAIL on a clean run.

The fourth bucket *is* recoverable: when Datelindja contains a city name and Vendi contains a parseable DD.MM.YYYY string, the doctor typed the fields in the wrong order. Both pieces of information are in the row.

## Decision

Three changes, all in the migration tool. Schema is unchanged.

### 1. Finer-grained orphan reason codes

`patients.py` `_classify_dob` emits one of:

- `year_only_dob`   — Datelindja matches `^\d{4}$`. Orphaned with a distinct reason so Dr. Taulant's review queue can be triaged separately from "no DOB at all".
- `dob_missing`     — Datelindja is null/blank/missing and Vendi can't rescue. Truly unrecoverable.
- `dob_unparseable` — anything else `parse_dob` rejects. Typos, Albanian age strings, partial dates.

Visit-import semantics are unchanged: a row whose patient is orphaned for any of these reasons becomes a `patient_not_found` orphan in the visit phase, exactly as before.

### 2. Vendi↔Datelindja swap recovery

When Vendi matches DD.MM.YYYY shape AND parses as a valid date, the parsed date wins and `swap_applied=True`. The caller then uses what was in Datelindja as `place_of_birth`. A `field_swap_recovered` warning is recorded against the row so the audit trail captures every patient where the heuristic fired.

Detection rule is conservative: requires Vendi to match the date *shape* (regex), then parse cleanly. Strings like `"Prizren"` cannot accidentally pass this gate. Verified on the audited file: exactly 3 rows fire the heuristic, matching the manual count.

### 3. Revised reconciliation PASS criteria

`reconciliation._verdict` no longer FAILs purely on `orphan_rate_pct > 2%`. It now computes:

```
expected_orphans  = orphans_by_reason["year_only_dob"] + orphans_by_reason["dob_missing"]
unexpected_pct    = (total_orphans - expected_orphans) / source_rows * 100
```

and only FAILs when `unexpected_pct > 2%`. The total orphan rate is still reported prominently in the JSON; the verdict reason cites both the expected and unexpected counts so the operator sees exactly why a high orphan rate did or didn't trigger FAIL.

The drift-zero criteria (`tool_minus_db == 0`, `db_minus_tool == 0`) are unchanged — those still auto-FAIL.

## Consequences

- Dry-run against the audited file now lands as PASS: total orphans 558 (5.0%) but only 85 unexpected (0.76%), comfortably under the threshold.
- The `field_swap_recovered` heuristic adds 3 patients to the imported set, with the recovery visible in `warnings.jsonl` and the per-reason breakdown in `migration-report.json`.
- The post-cutover review queue is segmented: ~473 patients (`year_only_dob` + `dob_missing`) for "needs DOB", ~85 for "data-entry typo, decide case by case".
- Adds one new constant in code (`_EXPECTED_ORPHAN_REASONS`). Future operators reviewing what counts as "expected" find a single chokepoint with a comment pointing back here.

## Revisit when

- Another tenant's source has different DOB-quality patterns. The carve-out list (`year_only_dob`, `dob_missing`) is policy, not law; a future tenant may want different exemptions.
- Dr. Taulant's post-cutover review surfaces a systematic pattern in the 85 "other typos" that would be safe to auto-recover. Add a new orphan reason and (if appropriate) expand the recovery heuristic.

## See also

- [ADR-010](./010-migration-approach.md) — overall migration approach. PASS criteria here refines the report design.
- [ADR-012](./012-vizitat-field-mapping-correction.md) — field-mapping correction. Independent of this ADR.
- [ADR-014](./014-access-reader-mdb-json.md) — the reader change that enabled this STEP-6-time discovery.
