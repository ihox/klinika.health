"""Phase 1 — patient import.

Reads Pacientet from the Access source, normalises every field, and
upserts into Klinika's `patients` table keyed by (clinic_id, legacy_id).

Edge cases handled here (rather than in the DB layer):

- DOB unparseable -> skip the row, log to orphans.jsonl. A pediatric
  patient with no DOB is clinically unsafe (growth charts, dosing,
  vaccinations all need it). The doctor reviews orphans manually
  post-cutover.

- Name with trailing asterisks -> strip from first/last_name, preserve
  verbatim in legacy_display_name, mark has_name_duplicate=true. The
  visit-import phase uses the original (starred) form to match
  Vizitat.x back to a patient.

- Birth weight 0 -> NULL (Access encodes "not recorded" as 0).

- Phone field populated for ~0.04% of rows. We normalise via parsers.parse_phone.

Idempotency: every insert is ON CONFLICT (clinic_id, legacy_id) DO
UPDATE. Re-running the tool with the same source is safe and updates
any field that has changed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .access import AbstractReader
from .models import PatientUpsertInput

if TYPE_CHECKING:
    from .db import Database
from .parsers import (
    clean_text,
    parse_dob,
    parse_decimal_cm,
    parse_int_grams,
    parse_name,
    parse_phone,
)
from .reports import JsonlWriter, PatientImportReport


PACIENTET_TABLE = "Pacientet"

# Access column names (verbatim from the audited source).
COL_ID = "ID"
COL_NAME = "Emri dhe mbiemri"
COL_DOB = "Datelindja"
COL_PLACE = "Vendi"
COL_BIRTH_WEIGHT = "PL"
COL_BIRTH_HEAD = "PK"
COL_BIRTH_LENGTH = "GJL"
COL_ALLERGIES = "Alergji"
COL_PHONE = "Telefoni"


@dataclass(frozen=True)
class _ParseFailure:
    """Returned when a row cannot become a Klinika patient."""

    reason: str


def import_patients(
    reader: AbstractReader,
    db: Database | None,
    clinic_id: str,
    *,
    dry_run: bool,
    logger: logging.Logger,
    warnings_writer: JsonlWriter,
    orphans_writer: JsonlWriter,
) -> PatientImportReport:
    report = PatientImportReport()
    report.source_rows = reader.count_rows(PACIENTET_TABLE)
    logger.info("patient_import.start", extra={"source_rows": report.source_rows, "dry_run": dry_run})

    for row in reader.iter_table(PACIENTET_TABLE):
        legacy_id = _coerce_legacy_id(row.get(COL_ID))
        if legacy_id is None:
            report.skipped_orphan += 1
            orphans_writer.write({"reason": "missing_legacy_id", "row": _safe_row(row)})
            continue

        parsed = _parse_row(row, legacy_id=legacy_id, report=report, warnings_writer=warnings_writer)
        if isinstance(parsed, _ParseFailure):
            report.skipped_orphan += 1
            orphans_writer.write(
                {"reason": parsed.reason, "legacy_id": legacy_id, "row": _safe_row(row)}
            )
            continue

        if parsed.has_name_duplicate:
            report.duplicate_names += 1

        if db is not None and not dry_run:
            db.upsert_patient(clinic_id, parsed)
        report.imported += 1

    logger.info(
        "patient_import.done",
        extra={
            "imported": report.imported,
            "skipped_orphan": report.skipped_orphan,
            "parse_warnings": report.parse_warnings,
            "duplicate_names": report.duplicate_names,
        },
    )
    return report


def _coerce_legacy_id(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _record_warning(
    report: PatientImportReport,
    writer: JsonlWriter,
    *,
    legacy_id: int,
    code: str,
    value: Any = None,
) -> None:
    report.warnings_by_code[code] += 1
    report.parse_warnings += 1
    writer.write({"legacy_id": legacy_id, "code": code, "value": value})


def _parse_row(
    row: dict[str, Any],
    *,
    legacy_id: int,
    report: PatientImportReport,
    warnings_writer: JsonlWriter,
) -> PatientUpsertInput | _ParseFailure:
    name = parse_name(row.get(COL_NAME))
    if name is None or not name.first_name or not name.last_name:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="name_unparseable",
            value=row.get(COL_NAME),
        )
        return _ParseFailure("name_unparseable")

    dob = parse_dob(row.get(COL_DOB))
    if dob is None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="dob_unparseable",
            value=row.get(COL_DOB),
        )
        return _ParseFailure("dob_unparseable")

    birth_weight_raw = row.get(COL_BIRTH_WEIGHT)
    birth_weight = parse_int_grams(birth_weight_raw)
    if birth_weight is None and birth_weight_raw not in (None, "", 0):
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="birth_weight_unparseable",
            value=birth_weight_raw,
        )

    birth_head_raw = row.get(COL_BIRTH_HEAD)
    birth_head = parse_decimal_cm(birth_head_raw)
    if birth_head is None and clean_text(birth_head_raw) is not None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="birth_head_unparseable",
            value=birth_head_raw,
        )

    birth_length_raw = row.get(COL_BIRTH_LENGTH)
    birth_length = parse_decimal_cm(birth_length_raw)
    if birth_length is None and clean_text(birth_length_raw) is not None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="birth_length_unparseable",
            value=birth_length_raw,
        )

    return PatientUpsertInput(
        legacy_id=legacy_id,
        legacy_display_name=name.legacy_display_name,
        has_name_duplicate=name.has_asterisks,
        first_name=name.first_name,
        last_name=name.last_name,
        date_of_birth=dob,
        place_of_birth=clean_text(row.get(COL_PLACE)),
        birth_weight_g=birth_weight,
        birth_head_circumference_cm=birth_head,
        birth_length_cm=birth_length,
        alergji_tjera=clean_text(row.get(COL_ALLERGIES)),
        phone=parse_phone(row.get(COL_PHONE)),
    )


def _safe_row(row: dict[str, Any]) -> dict[str, Any]:
    """Strip None values from the row so JSONL output stays compact."""
    return {k: v for k, v in row.items() if v not in (None, "")}
