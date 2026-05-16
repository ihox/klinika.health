# ADR 012: Vizitat field-mapping correction (supersedes ADR-010 on FK and payment columns)

Date: 2026-05-16
Status: Accepted — partially supersedes ADR-010

## Context

[ADR-010](./010-migration-approach.md) documents the Access → Postgres migration approach. Two specific claims in its source-data findings were wrong, and acting on them would silently corrupt the entire visit import:

- ADR-010 says: *"Vizitat … rows linked to patients via fuzzy `ALERT` column (asterisk-suffixed names)"* and *"`x` column in `Vizitat`: payment code (E/A/B/C/D) — preserved."*
- A re-audit of `PEDIATRIA.accdb` for slice 17 contradicts both claims. The FK is `Vizitat.x`; the payment code lives in `Vizitat.Tjera`; `Vizitat.ALERT` is the medical-alert memo.

The error originated in an early manual inspection. Pre-implementation tooling never exercised the assumption (the slice-01 stub at `tools/migrate/migrate.py` never reads `Vizitat`), so the mistake went undetected until slice 17 stood up the visit-import phase and re-audited.

## Evidence

The Access database's own declared relationship is authoritative:

```
$ mdb-export PEDIATRIA.accdb MSysRelationships
… szObject="Vizitat", szColumn="x",
  szReferencedObject="Pacientet",
  szReferencedColumn="Emri dhe mbiemri" …
```

Confirmed by row-sample inspection (using pipe-delimited export to dodge the memo-newline issue):

- `Vizitat.x` holds patient name strings ("Rita Hoxha", "Jon Gashi *", …) matching `Pacientet."Emri dhe mbiemri"` byte-for-byte including the asterisk-suffix uniqueness workaround.
- `Vizitat.Tjera` holds single-character payment codes (`A`, `B`, `C`, `D`, `E`, or empty) — consistent with the schema docstring on [`Visit.paymentCode`](../../apps/api/prisma/schema.prisma) which expects this exact alphabet.
- `Vizitat.ALERT` is a Memo column, typically empty; populated only when the doctor wrote a clinically-significant alert.

Row-count sanity (~5 visits matched for one known patient, `COUNT(DISTINCT x)` in the 5k–11k range) matches Dr. Taulant's UI history. The ADR-010 mapping would have produced ~220k orphan visits and ~11k payment-code values like `"Rita Hoxha"`.

## Decision

The visit-import phase uses the corrected mapping below. ADR-010 is left intact for historical context; its status is updated to flag the supersession.

| Vizitat column | Klinika target           | Notes                                                                         |
| -------------- | ------------------------ | ----------------------------------------------------------------------------- |
| `ID`           | `visits.legacy_id`       | Idempotency key paired with `clinic_id`.                                      |
| `Data`         | `visits.visit_date`      | Parse MM/DD/YY → date (UTC date column).                                      |
| `Ushqimi`      | `visits.feeding_notes`   | Memo, free text.                                                              |
| `Ankesa`       | `visits.complaint`       | Memo.                                                                         |
| `Ekzaminimet`  | `visits.examinations`    | Memo.                                                                         |
| `Ultrazeri`    | `visits.ultrasound_notes`| Memo.                                                                         |
| `Temp`         | `visits.temperature_c`   | Text → Decimal(4,2). Plausible range 30–45.                                   |
| `PT`           | `visits.weight_g`        | Text → int grams. Values <100 treated as kg, multiplied by 1000.              |
| `PK`           | `visits.head_circumference_cm` | Text → Decimal(5,2).                                                    |
| `GJT`          | `visits.height_cm`       | Text → Decimal(5,2).                                                          |
| `SN`           | dropped                  | Per ADR-010, unknown boolean.                                                 |
| `Diagnoza`     | `visits.legacy_diagnosis`| Free text. `visit_diagnoses` (structured ICD-10) stays empty for migrated rows. |
| `Terapia`      | `visits.prescription`    | Memo. Therapy / Rx free text.                                                 |
| `Analizat`     | `visits.lab_results`     | Memo.                                                                         |
| `Kontrolla`    | `visits.followup_notes`  | Text. Next-checkup note.                                                      |
| `Tjera`        | `visits.payment_code`    | Single char `{A,B,C,D}` → as-is. `E` → NULL + warning (semantics unknown). Anything else → NULL + warning. |
| `x`            | patient FK lookup        | Matches `patients.legacy_display_name` (asterisks preserved). No match → orphan, skip. |
| `ALERT`        | `visits.other_notes`     | Memo. Prefixed `"ALERT: "` on insert. When empty, `other_notes` stays NULL.   |

Required NOT-NULL columns the source does not provide:

- `clinic_id` — from config (`target.clinic_subdomain` → lookup).
- `created_by` / `updated_by` — Dr. Taulant's `users.id`, resolved at startup from `users.email = taulant.shala@klinika.health` (configurable via `target.migration_user_email` for future clinics). All migrated visits credit him as the author; he is the only doctor who ever saw these patients in the legacy system.
- `status` — always `completed`.
- `scheduled_for` — always NULL (no booking concept in the source).
- `is_walk_in` — always `false`.

## Preflight sanity checks

Before the visit-import loop the tool runs two cardinality probes against the Access source and aborts on mismatch:

1. `SELECT DISTINCT Tjera FROM Vizitat` — expected cardinality ≤ 10. Hundreds of distinct values means the column is not the payment code after all, and the mapping is wrong.
2. `SELECT COUNT(DISTINCT x) FROM Vizitat` — expected 5,000–11,500. Values outside this band mean `x` is not the FK column.

Both bounds are conservative; the actual observed values today are 5–7 and ~8,500. The point is to fail loudly if a future re-audit of a fresh `.accdb` finds the columns have drifted, rather than silently producing a corrupted database.

## Consequences

- ADR-010 stays in the repository as historical record. Its supersession notice points readers here for the correct mapping.
- The migration tool ships with the corrected behaviour from day one; no on-disk rows produced by the wrong mapping ever existed.
- The `E` payment-code carve-out is a clinical-safety choice, not a schema constraint. Dr. Taulant can backfill if the code's meaning becomes clear later. The warning row in the report keeps that follow-up visible.

## Revisit when

- A new customer's `.accdb` is audited and the column roles differ (the tool's preflight checks will detect this).
- Dr. Taulant resolves the `E` payment-code semantics — once known, drop the NULL-replacement rule and migrate the value as-is.

## See also

- [ADR-010](./010-migration-approach.md) — overall migration approach (idempotent upserts, legacy_id keys, no checkpointing).
- [ADR-011](./011-unified-visit-model.md) — unified `visits` table (the migration target).
