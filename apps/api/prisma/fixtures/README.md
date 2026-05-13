# Fixtures

Static reference data loaded by `prisma/seed.ts`.

## `icd10.csv`

WHO ICD-10 codes with Latin descriptions. Columns:

| column              | type    | notes                                                        |
|---------------------|---------|--------------------------------------------------------------|
| `code`              | string  | Primary key. 3- or 4-character WHO code (e.g. `J20.9`).      |
| `latin_description` | string  | Medical-Latin description used by Albanian/Kosovo clinicians.|
| `chapter`           | string  | Chapter label (e.g. `Chapter X: Diseases of the respiratory system`). |
| `common`            | boolean | `true` for codes that surface first in the ICD-10 picker.    |

The committed file is a **development subset** (~300 codes) focused on
pediatric pathology so the autocomplete behaves realistically while
working locally. Production installs replace it with the full WHO ICD-10
dataset (~14,000 rows) before going live; the seed script handles any
row count.

### How to refresh from the full WHO dataset

The WHO publishes the ICD-10 in Latin form. Steps:

1. Download the regional Latin-description CSV from the Kosovo Ministry
   of Health or the WHO regional office.
2. Reshape to the four columns above, with quoted strings containing commas.
3. Replace `icd10.csv` and re-run `make db-seed`.

The seed performs an `UPSERT` keyed by `code`, so re-running is safe.
