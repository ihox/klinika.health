"""Phase 2 — visit import.

Reads Vizitat from the Access source, maps each row per the
corrected field table in ADR-012, and upserts into Klinika's `visits`
table keyed by (clinic_id, legacy_id).

Field mapping (per ADR-012):

  Vizitat.x       -> patient FK via patients.legacy_display_name
  Vizitat.Tjera   -> visits.payment_code   (A/B/C/D, else NULL+warning)
  Vizitat.ALERT   -> visits.other_notes    (prefixed "ALERT: ")
  …                                          (full table in ADR-012)

Edge cases:

- Vizitat.x with no matching patient -> orphan, skip. Common cause:
  patient was already orphaned in Phase 1 (unparseable DOB).

- Visit date unparseable -> orphan, skip. visit_date is NOT NULL.

- Payment code 'E' or anything outside {A,B,C,D} -> NULL + warning.
  ADR-012 documents the safety rationale.

The phase begins with two preflight cardinality probes (ADR-012):
  - distinct values in Tjera should be ≤ 10
  - distinct values in x should be 5,000–11,500
A mismatch aborts before any insert.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .access import AbstractReader
from .models import VisitUpsertInput

if TYPE_CHECKING:
    from .db import Database
from .parsers import (
    clean_text,
    parse_decimal_cm,
    parse_int_grams,
    parse_temperature,
    parse_visit_date,
)
from .reports import JsonlWriter, VisitImportReport


VIZITAT_TABLE = "Vizitat"

# Access column names (verbatim from the audited source, ADR-012 table).
COL_ID = "ID"
COL_DATE = "Data"
COL_FEEDING = "Ushqimi"
COL_COMPLAINT = "Ankesa"
COL_EXAM = "Ekzaminimet"
COL_ULTRASOUND = "Ultrazeri"
COL_TEMP = "Temp"
COL_WEIGHT = "PT"
COL_HEAD = "PK"
COL_HEIGHT = "GJT"
COL_DIAGNOSIS = "Diagnoza"
COL_THERAPY = "Terapia"
COL_ANALYSES = "Analizat"
COL_FOLLOWUP = "Kontrolla"
COL_PAYMENT = "Tjera"
COL_PATIENT = "x"
COL_ALERT = "ALERT"

# Bounds for the preflight probes (ADR-012, refined by ADR-016).
#
# Tjera in the audited file has 93 distinct values but the top 5 cover
# 99.72% — a real payment-code column has a small alphabet plus a
# long thin tail of data-entry noise. The original "<= 10 distinct"
# rule would have rejected this file out of hand. Coverage-based is
# the right shape: a free-text / mis-mapped column has *no* dominant
# values and fails the coverage test even with 10 distinct (because
# they each cover <10%).
PAYMENT_TOP_N = 10
PAYMENT_TOP_N_MIN_COVERAGE = 0.99
PATIENT_CARDINALITY_MIN = 5_000
PATIENT_CARDINALITY_MAX = 11_500

# Payment-code alphabet (ADR-012 + ADR-016). D never appears in the
# DonetaMED file today but stays in the set so a future row carrying
# it migrates without code change.
_KNOWN_PAYMENT_CODES = frozenset({"A", "B", "C", "D", "E"})


@dataclass(frozen=True)
class _ParseFailure:
    reason: str


def run_preflight_checks(reader: AbstractReader, logger: logging.Logger) -> None:
    """Verify the source columns match ADR-012 before we touch anything.

    Single full pass over Vizitat tallies three things at once: total
    row count, frequency-weighted distribution of `Tjera` values
    (expected to be a small payment-code alphabet dominating the
    rows), and distinct `x` values (expected to be ~5k-11k patient
    names). Doing it inline rather than as `SELECT DISTINCT …` keeps
    the same code path working for stubbed readers in tests, and the
    cost is the same iteration we'd do anyway.

    Tjera rule (ADR-016): top-10 distinct values must cover at least
    99% of rows. The DonetaMED file has 93 distinct values with a
    long thin tail (date ranges, dashes, hospitalisation periods);
    top 5 alone cover 99.72%. A free-text or mis-mapped column would
    fail this — its top 10 would be effectively random and each
    cover <10%.
    """
    payment_counter: Counter[Any] = Counter()
    patient_values: set[Any] = set()
    total_rows = 0
    for row in reader.iter_table(VIZITAT_TABLE):
        total_rows += 1
        payment_counter[row.get(COL_PAYMENT)] += 1
        patient_values.add(row.get(COL_PATIENT))

    if total_rows > 0:
        top_n_rows = sum(n for _, n in payment_counter.most_common(PAYMENT_TOP_N))
        top_n_coverage = top_n_rows / total_rows
        if top_n_coverage < PAYMENT_TOP_N_MIN_COVERAGE:
            raise RuntimeError(
                f"Preflight check failed: Vizitat.{COL_PAYMENT} top "
                f"{PAYMENT_TOP_N} values cover only "
                f"{top_n_coverage * 100:.2f}% of rows "
                f"(expected >= {PAYMENT_TOP_N_MIN_COVERAGE * 100:.0f}% per ADR-016). "
                "The column may not be the payment code in this source — "
                "re-audit before re-running."
            )

    n_patients = len(patient_values - {None, ""})
    if not (PATIENT_CARDINALITY_MIN <= n_patients <= PATIENT_CARDINALITY_MAX):
        raise RuntimeError(
            f"Preflight check failed: Vizitat.{COL_PATIENT} has {n_patients} distinct "
            f"non-empty values (expected {PATIENT_CARDINALITY_MIN}-{PATIENT_CARDINALITY_MAX} "
            "per ADR-012). The column may not be the patient FK in this source — re-audit "
            "before re-running."
        )

    logger.info(
        "visit_preflight.ok",
        extra={
            "source_rows": total_rows,
            "payment_codes_distinct": len(payment_counter),
            "payment_codes_top_n_coverage_pct": round((top_n_rows / total_rows) * 100, 2)
            if total_rows
            else 0.0,
            "patient_names_distinct": n_patients,
        },
    )


def import_visits(
    reader: AbstractReader,
    db: Database | None,
    clinic_id: str,
    migration_user_id: str,
    patient_lookup: dict[str, str],
    *,
    dry_run: bool,
    logger: logging.Logger,
    warnings_writer: JsonlWriter,
    orphans_writer: JsonlWriter,
) -> VisitImportReport:
    report = VisitImportReport()
    logger.info(
        "visit_import.start",
        extra={
            "dry_run": dry_run,
            "patient_lookup_size": len(patient_lookup),
        },
    )

    for row in reader.iter_table(VIZITAT_TABLE):
        report.source_rows += 1
        legacy_id = _coerce_legacy_id(row.get(COL_ID))
        if legacy_id is None:
            report.skipped_orphan += 1
            orphans_writer.write({"reason": "missing_legacy_id", "row": _safe_row(row)})
            continue

        outcome = _parse_row(
            row,
            legacy_id=legacy_id,
            patient_lookup=patient_lookup,
            report=report,
            warnings_writer=warnings_writer,
        )
        if isinstance(outcome, _ParseFailure):
            report.skipped_orphan += 1
            orphans_writer.write(
                {"reason": outcome.reason, "legacy_id": legacy_id, "row": _safe_row(row)}
            )
            continue

        if db is not None and not dry_run:
            db.upsert_visit(clinic_id, migration_user_id, outcome)
        report.imported += 1

    logger.info(
        "visit_import.done",
        extra={
            "source_rows": report.source_rows,
            "imported": report.imported,
            "skipped_orphan": report.skipped_orphan,
            "parse_warnings": report.parse_warnings,
        },
    )
    return report


# ---------------------------------------------------------------------------
# Row parsing
# ---------------------------------------------------------------------------


def _parse_row(
    row: dict[str, Any],
    *,
    legacy_id: int,
    patient_lookup: dict[str, str],
    report: VisitImportReport,
    warnings_writer: JsonlWriter,
) -> VisitUpsertInput | _ParseFailure:
    patient_name = row.get(COL_PATIENT)
    if not patient_name or not str(patient_name).strip():
        _record_warning(report, warnings_writer, legacy_id=legacy_id, code="missing_patient_name")
        return _ParseFailure("missing_patient_name")

    patient_id = patient_lookup.get(str(patient_name).strip())
    if patient_id is None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="patient_not_found",
            value=patient_name,
        )
        return _ParseFailure("patient_not_found")

    visit_date = parse_visit_date(row.get(COL_DATE))
    if visit_date is None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="visit_date_unparseable",
            value=row.get(COL_DATE),
        )
        return _ParseFailure("visit_date_unparseable")

    payment_code = _map_payment_code(
        row.get(COL_PAYMENT),
        legacy_id=legacy_id,
        report=report,
        warnings_writer=warnings_writer,
    )

    other_notes = _format_alert(clean_text(row.get(COL_ALERT)))

    weight_raw = row.get(COL_WEIGHT)
    weight = parse_int_grams(weight_raw)
    if weight is None and clean_text(weight_raw) is not None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="weight_unparseable",
            value=weight_raw,
        )

    height_raw = row.get(COL_HEIGHT)
    height = parse_decimal_cm(height_raw)
    if height is None and clean_text(height_raw) is not None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="height_unparseable",
            value=height_raw,
        )

    head_raw = row.get(COL_HEAD)
    head = parse_decimal_cm(head_raw)
    if head is None and clean_text(head_raw) is not None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="head_unparseable",
            value=head_raw,
        )

    temp_raw = row.get(COL_TEMP)
    temp = parse_temperature(temp_raw)
    if temp is None and clean_text(temp_raw) is not None:
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="temperature_unparseable",
            value=temp_raw,
        )

    return VisitUpsertInput(
        legacy_id=legacy_id,
        patient_id=patient_id,
        visit_date=visit_date,
        complaint=clean_text(row.get(COL_COMPLAINT)),
        feeding_notes=clean_text(row.get(COL_FEEDING)),
        weight_g=weight,
        height_cm=height,
        head_circumference_cm=head,
        temperature_c=temp,
        payment_code=payment_code,
        examinations=clean_text(row.get(COL_EXAM)),
        ultrasound_notes=clean_text(row.get(COL_ULTRASOUND)),
        legacy_diagnosis=clean_text(row.get(COL_DIAGNOSIS)),
        prescription=clean_text(row.get(COL_THERAPY)),
        lab_results=clean_text(row.get(COL_ANALYSES)),
        followup_notes=clean_text(row.get(COL_FOLLOWUP)),
        other_notes=other_notes,
    )


def _map_payment_code(
    raw: Any,
    *,
    legacy_id: int,
    report: VisitImportReport,
    warnings_writer: JsonlWriter,
) -> str | None:
    """Map Vizitat.Tjera to visits.payment_code.

    Per ADR-016 (refining ADR-012):

      - Single-letter values are case-folded to upper. `a`/`b`/`c`/`e`
        in the source are typos for the same code in upper-case and
        are recovered as-is (~29 rows in the audited file).
      - {A, B, C, D, E} are migrated as the payment code. E was
        originally NULL'd as "semantics unknown"; STEP 6 found E is
        22% of all visits in the live source, so it's clearly real
        signal. D never appears today but stays in the alphabet for
        forward-compatibility.
      - Other single letters (e.g. `U`, 52 rows) emit a
        `payment_code_unknown_letter` warning and store NULL.
      - Multi-character values (date ranges like `29-30.01.2025`,
        dashes, free text — ~80 distinct rows in total) emit a
        `payment_code_non_code` warning and store NULL.
    """
    text = clean_text(str(raw) if raw is not None else None)
    if text is None:
        return None
    if len(text) == 1 and text.isalpha():
        upper = text.upper()
        if upper in _KNOWN_PAYMENT_CODES:
            return upper
        _record_warning(
            report,
            warnings_writer,
            legacy_id=legacy_id,
            code="payment_code_unknown_letter",
            value=text,
        )
        return None
    _record_warning(
        report,
        warnings_writer,
        legacy_id=legacy_id,
        code="payment_code_non_code",
        value=text,
    )
    return None


def _format_alert(alert: str | None) -> str | None:
    """ALERT memo -> other_notes prefix.

    Per ADR-012: when ALERT is non-empty we write
    "ALERT: <content>" into visits.other_notes. When ALERT is empty
    other_notes stays NULL — the migration source has no separate
    "general notes" column to merge with (Vizitat.Tjera is the
    payment code, not free notes).
    """
    if not alert:
        return None
    return f"ALERT: {alert}"


def _coerce_legacy_id(raw: Any) -> int | None:
    if raw is None:
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _record_warning(
    report: VisitImportReport,
    writer: JsonlWriter,
    *,
    legacy_id: int,
    code: str,
    value: Any = None,
) -> None:
    report.warnings_by_code[code] += 1
    report.parse_warnings += 1
    writer.write({"legacy_id": legacy_id, "code": code, "value": value})


def _safe_row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if v not in (None, "")}
