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
import re
from dataclasses import dataclass
from datetime import date
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


@dataclass(frozen=True)
class _DobOutcome:
    """Output of `_classify_dob` — see ADR-015 for the policy.

    `parsed` is the date (None if the row should be orphaned),
    `reason` is the orphan-reason code (None on success),
    `swap_applied` is True when the date came from the Vendi column
    instead of Datelindja (the doctor swapped the fields).
    """

    parsed: date | None
    reason: str | None
    swap_applied: bool


# DD.MM.YYYY shape; used to detect the Vendi↔Datelindja swap case.
_DOB_SHAPE = re.compile(r"^\d{1,2}[./\-]\d{1,2}[./\-]\d{4}$")
# Year-only fingerprint (e.g. "2018"). Per ADR-015, orphaned with a
# distinct reason so the doctor's post-cutover review queue separates
# "no DOB at all" from "DOB approximate".
_YEAR_ONLY = re.compile(r"^\d{4}$")


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
    logger.info("patient_import.start", extra={"dry_run": dry_run})

    for row in reader.iter_table(PACIENTET_TABLE):
        report.source_rows += 1
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
            "source_rows": report.source_rows,
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


def _classify_dob(raw_dob: Any, raw_vendi: Any) -> _DobOutcome:
    """Map a (Datelindja, Vendi) pair to a parsed DOB + reason code.

    Three orphan-reason codes are emitted instead of the original
    catch-all `dob_unparseable` (ADR-015):

      `dob_missing`     — Datelindja absent / blank and Vendi can't
                          rescue the row.
      `year_only_dob`   — Datelindja is exactly four digits ("2018").
                          We refuse to import: pediatric charts need
                          month + day for growth charts, dosing, and
                          milestones.
      `dob_unparseable` — anything else parse_dob can't handle (typos
                          like "31.09.2022", "08..02.2023", Albanian
                          age strings "21 vjeq").

    The Vendi↔Datelindja swap detection rescues the few rows where
    the doctor typed the DOB into the city field and vice versa.
    Detection rule (conservative): Vendi matches DD.MM.YYYY shape AND
    parses as a valid date. When that fires, the parsed date wins and
    `swap_applied=True` so the caller swaps `place_of_birth` too.
    """
    raw_dob_str = str(raw_dob).strip() if raw_dob is not None else ""
    swap_candidate = None
    if isinstance(raw_vendi, str):
        vendi_stripped = raw_vendi.strip()
        if _DOB_SHAPE.match(vendi_stripped):
            swap_candidate = parse_dob(vendi_stripped)

    if raw_dob_str:
        if _YEAR_ONLY.match(raw_dob_str):
            return _DobOutcome(parsed=None, reason="year_only_dob", swap_applied=False)
        parsed = parse_dob(raw_dob_str)
        if parsed is not None:
            return _DobOutcome(parsed=parsed, reason=None, swap_applied=False)
        # Datelindja exists but doesn't parse. If Vendi looks like a
        # date AND Datelindja looks like a non-date string, swap.
        if swap_candidate is not None and not _DOB_SHAPE.match(raw_dob_str):
            return _DobOutcome(parsed=swap_candidate, reason=None, swap_applied=True)
        return _DobOutcome(parsed=None, reason="dob_unparseable", swap_applied=False)

    # Datelindja is blank/missing. Vendi may still rescue.
    if swap_candidate is not None:
        return _DobOutcome(parsed=swap_candidate, reason=None, swap_applied=True)
    return _DobOutcome(parsed=None, reason="dob_missing", swap_applied=False)


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

    dob_outcome = _classify_dob(row.get(COL_DOB), row.get(COL_PLACE))
    if dob_outcome.parsed is None:
        assert dob_outcome.reason is not None
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code=dob_outcome.reason,
            value=row.get(COL_DOB),
        )
        return _ParseFailure(dob_outcome.reason)

    if dob_outcome.swap_applied:
        # Datelindja held the city name and Vendi held the DOB. Use
        # the (now correctly-typed) date and pull place_of_birth from
        # what was sitting in the Datelindja field.
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="field_swap_recovered",
            value=row.get(COL_DOB),
        )
        place_text = clean_text(row.get(COL_DOB))
    else:
        place_text = clean_text(row.get(COL_PLACE))
    dob = dob_outcome.parsed

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
        place_of_birth=place_text,
        birth_weight_g=birth_weight,
        birth_head_circumference_cm=birth_head,
        birth_length_cm=birth_length,
        alergji_tjera=clean_text(row.get(COL_ALLERGIES)),
        phone=parse_phone(row.get(COL_PHONE)),
    )


def _safe_row(row: dict[str, Any]) -> dict[str, Any]:
    """Strip None values from the row so JSONL output stays compact."""
    return {k: v for k, v in row.items() if v not in (None, "")}
