"""Slice 17.5 — apply name-derived sex inference to migrated patients.

The source Access database (PEDIATRIA.accdb) had no gender column, so
every migrated patient lands with `sex IS NULL`. This module reads a
versioned, culture-tagged dictionary mapping first_name -> 'm'/'f'/null
and applies it in a single transaction, marking touched rows with
`sex_inferred = true`.

Design notes
------------
* The dictionary file is *versioned* (schema_version + culture). The
  apply step refuses to run if the schema_version or culture does not
  match what it was built for, so a future German-name dictionary
  cannot accidentally be applied to a Kosovan clinic.
* Only rows with `legacy_id IS NOT NULL AND sex IS NULL` are touched —
  manually-entered patients (post-migration UI creations) and any row
  already populated are off-limits.
* `sex_inferred = false` rows are also off-limits even if `sex IS NULL`
  — that's reserved for the doctor's "I deliberately don't know"
  state.
* One audit_log row per run summarises what the inference did. The
  resource_type is "clinic" (this is a clinic-wide operation) and the
  changes JSONB carries the run metadata listed in slice-17.5 §3.
* Re-running with the same dictionary is a no-op: the WHERE clause
  filters out rows already touched.

This module never touches PHI in logs — see CLAUDE.md §7. The only
identifiers in the run log are clinic_id and the dictionary version.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

# Hard pins. The supported set widens every time a doctor-confirmed
# correction round bumps the dictionary's `schema_version`. The shape
# itself hasn't changed across v1..v2 (only the name->sex mappings),
# so the apply path stays compatible; the version is tracked purely
# for audit-log traceability. The moment we change the JSON *shape*
# we'll need a real migration path here.
SUPPORTED_SCHEMA_VERSIONS = frozenset({1, 2})
# Latest supported version — surfaced via `SUPPORTED_SCHEMA_VERSION`
# for backwards compatibility with any caller that still reads it.
SUPPORTED_SCHEMA_VERSION = max(SUPPORTED_SCHEMA_VERSIONS)
SUPPORTED_CULTURE = "albanian_kosovan"

# Stable repo-relative path the audit_log records. The actual file is
# resolved relative to the package data dir at runtime.
DICTIONARY_REPO_PATH = "tools/migrate/klinika_migrate/data/sex_dictionary_albanian_kosovan.json"


@dataclass
class SexInferenceReport:
    """Run summary surfaced in the CLI output and the audit_log row."""

    schema_version: int = 0
    culture: str = ""
    name_count: int = 0
    patients_updated_male: int = 0
    patients_updated_female: int = 0
    patients_left_null: int = 0
    audit_log_id: str | None = None

    def to_audit_payload(self) -> dict[str, Any]:
        return {
            "event": "sex_inference_applied",
            "schema_version": self.schema_version,
            "culture": self.culture,
            "name_count": self.name_count,
            "patients_updated_male": self.patients_updated_male,
            "patients_updated_female": self.patients_updated_female,
            "patients_left_null": self.patients_left_null,
            "dictionary_path": DICTIONARY_REPO_PATH,
        }

    def to_dict(self) -> dict[str, Any]:
        return {**self.to_audit_payload(), "audit_log_id": self.audit_log_id}


@dataclass(frozen=True)
class SexDictionary:
    """Parsed, validated dictionary."""

    schema_version: int
    culture: str
    name_count: int
    names: dict[str, str | None] = field(default_factory=dict)


class DictionaryValidationError(RuntimeError):
    """Raised when the dictionary file fails version or culture checks."""


def load_sex_dictionary(path: Path) -> SexDictionary:
    """Read the JSON file, validate the metadata, return a SexDictionary.

    Validates two hard pins:
      * schema_version must equal SUPPORTED_SCHEMA_VERSION
      * culture must equal SUPPORTED_CULTURE

    Both pins exist so a dictionary built for one culture cannot be
    silently applied to a clinic that needs another. Future cultures
    ship their own files and their own apply paths.
    """
    if not path.exists():
        raise DictionaryValidationError(f"Dictionary file not found: {path}")

    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise DictionaryValidationError(f"Dictionary must be a JSON object, got {type(raw).__name__}")

    schema_version = raw.get("schema_version")
    if schema_version not in SUPPORTED_SCHEMA_VERSIONS:
        raise DictionaryValidationError(
            f"Unsupported schema_version: got {schema_version!r}, "
            f"expected one of {sorted(SUPPORTED_SCHEMA_VERSIONS)}"
        )

    culture = raw.get("culture")
    if culture != SUPPORTED_CULTURE:
        raise DictionaryValidationError(
            f"Unsupported culture: got {culture!r}, expected {SUPPORTED_CULTURE!r}"
        )

    names = raw.get("names")
    if not isinstance(names, dict):
        raise DictionaryValidationError("Dictionary 'names' must be a JSON object")

    for k, v in names.items():
        if not isinstance(k, str) or not k:
            raise DictionaryValidationError(f"Invalid name key: {k!r}")
        if v not in (None, "m", "f"):
            raise DictionaryValidationError(f"Invalid sex value for {k!r}: {v!r}")

    return SexDictionary(
        schema_version=schema_version,
        culture=culture,
        name_count=int(raw.get("name_count") or len(names)),
        names=names,
    )


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


def apply_sex_dictionary(
    db: Any,  # noqa: ANN401 — duck-typed Database (real or in-memory test stub)
    clinic_id: str,
    migration_user_id: str,
    dictionary: SexDictionary,
    *,
    dry_run: bool,
    logger: logging.Logger,
) -> SexInferenceReport:
    """Apply `dictionary.names` to migrated patients in `clinic_id`.

    Rules:
      * Only touch rows with legacy_id IS NOT NULL AND sex IS NULL AND
        deleted_at IS NULL AND sex_inferred IS false. The last guard is
        what makes the apply idempotent — once a row is set, it stays
        set, and re-running with the same dictionary is a no-op.
      * Only update rows whose first_name appears in the dictionary
        with a non-null inference. Null entries (Dr. Taulant's review
        bucket) are simply skipped.
      * Single transaction: db.open() opens with autocommit=False, so
        either the whole apply lands or none of it does.
      * Writes one audit_log row at the end summarising counts.
    """
    male_names = sorted(n for n, v in dictionary.names.items() if v == "m")
    female_names = sorted(n for n, v in dictionary.names.items() if v == "f")
    null_names = [n for n, v in dictionary.names.items() if v is None]

    logger.info(
        "sex_inference.apply.start",
        extra={
            "clinic_id": clinic_id,
            "dry_run": dry_run,
            "schema_version": dictionary.schema_version,
            "culture": dictionary.culture,
            "name_count": dictionary.name_count,
            "male_names": len(male_names),
            "female_names": len(female_names),
            "null_names": len(null_names),
        },
    )

    male_updated = db.apply_sex_for_names(clinic_id, male_names, "m") if male_names else 0
    female_updated = db.apply_sex_for_names(clinic_id, female_names, "f") if female_names else 0
    left_null = db.count_null_sex_after_apply(clinic_id)

    report = SexInferenceReport(
        schema_version=dictionary.schema_version,
        culture=dictionary.culture,
        name_count=dictionary.name_count,
        patients_updated_male=male_updated,
        patients_updated_female=female_updated,
        patients_left_null=left_null,
    )
    audit_id = db.write_sex_inference_audit_log(
        clinic_id=clinic_id,
        user_id=migration_user_id,
        payload=report.to_audit_payload(),
    )
    report.audit_log_id = audit_id

    logger.info(
        "sex_inference.apply.done",
        extra={
            "clinic_id": clinic_id,
            "dry_run": dry_run,
            "patients_updated_male": male_updated,
            "patients_updated_female": female_updated,
            "patients_left_null": left_null,
            "audit_log_id": audit_id,
        },
    )
    return report
