"""Integration-style tests for the patient-import phase.

Runs `import_patients` against a stub Access reader and verifies the
returned PatientUpsertInput shape, the report counters, and the
warnings/orphans JSONL output.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest

from klinika_migrate.patients import import_patients
from klinika_migrate.reports import JsonlWriter, PatientImportReport
from tests.conftest import StubReader


def _row(
    *,
    id_: int,
    name: str | None,
    dob: str | None,
    place: str | None = None,
    pl: int | str | None = None,
    pk: str | None = None,
    gjl: str | None = None,
    allergies: str | None = None,
    phone: int | None = None,
) -> dict[str, object | None]:
    """Build a Pacientet-shaped row."""
    return {
        "ID": id_,
        "Emri dhe mbiemri": name,
        "Datelindja": dob,
        "Vendi": place,
        "PL": pl,
        "PK": pk,
        "GJL": gjl,
        "Alergji": allergies,
        "Telefoni": phone,
    }


class CapturingDB:
    """Stand-in Database that records every upsert_patient call so
    tests can assert on the exact PatientUpsertInput the caller
    produced. No actual DB connection — pure in-memory."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def upsert_patient(self, clinic_id: str, payload: object) -> str:  # noqa: ANN401 — duck-typed
        self.calls.append((clinic_id, payload))
        return f"uuid-{len(self.calls)}"


def _import(
    rows: list[dict],
    *,
    db: CapturingDB | None,
    tmp_path: Path,
    dry_run: bool = False,
) -> tuple[PatientImportReport, list[dict], list[dict]]:
    reader = StubReader({"Pacientet": rows})
    warnings_writer = JsonlWriter(tmp_path / "w.jsonl")
    orphans_writer = JsonlWriter(tmp_path / "o.jsonl")
    log = logging.getLogger("test")
    try:
        report = import_patients(
            reader,
            db,  # type: ignore[arg-type] — duck-typed
            clinic_id="cid-1",
            dry_run=dry_run,
            logger=log,
            warnings_writer=warnings_writer,
            orphans_writer=orphans_writer,
        )
    finally:
        warnings_writer.close()
        orphans_writer.close()

    warnings = [json.loads(line) for line in (tmp_path / "w.jsonl").read_text().splitlines() if line.strip()]
    orphans = [json.loads(line) for line in (tmp_path / "o.jsonl").read_text().splitlines() if line.strip()]
    return report, warnings, orphans


# ---------------------------------------------------------------------------
# Happy paths
# ---------------------------------------------------------------------------


def test_happy_path_inserts_and_reports(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(id_=1, name="Rita Hoxha", dob="01.02.2010", pl=3090, gjl="52", phone=44123456)]
    report, warnings, orphans = _import(rows, db=db, tmp_path=tmp_path)

    assert report.source_rows == 1
    assert report.imported == 1
    assert report.skipped_orphan == 0
    assert report.parse_warnings == 0
    assert report.duplicate_names == 0
    assert warnings == []
    assert orphans == []

    clinic_id, payload = db.calls[0]
    assert clinic_id == "cid-1"
    assert payload.legacy_id == 1  # type: ignore[attr-defined]
    assert payload.first_name == "Rita"  # type: ignore[attr-defined]
    assert payload.last_name == "Hoxha"  # type: ignore[attr-defined]
    assert payload.has_name_duplicate is False  # type: ignore[attr-defined]
    assert payload.date_of_birth == date(2010, 2, 1)  # type: ignore[attr-defined]
    assert payload.birth_weight_g == 3090  # type: ignore[attr-defined]
    assert payload.birth_length_cm == Decimal("52.00")  # type: ignore[attr-defined]
    assert payload.phone == "+383 44123456"  # type: ignore[attr-defined]


def test_asterisk_name_flags_duplicate(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(id_=1, name="Rita Hoxha*", dob="01.02.2010")]
    report, _, _ = _import(rows, db=db, tmp_path=tmp_path)

    assert report.imported == 1
    assert report.duplicate_names == 1
    payload = db.calls[0][1]
    assert payload.has_name_duplicate is True  # type: ignore[attr-defined]
    assert payload.legacy_display_name == "Rita Hoxha*"  # type: ignore[attr-defined]
    assert payload.first_name == "Rita"  # type: ignore[attr-defined]
    assert payload.last_name == "Hoxha"  # type: ignore[attr-defined]


def test_double_asterisk_with_whitespace(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(id_=1, name="Jon Gashi **", dob="15.05.2015")]
    report, _, _ = _import(rows, db=db, tmp_path=tmp_path)

    assert report.imported == 1
    assert report.duplicate_names == 1
    payload = db.calls[0][1]
    assert payload.legacy_display_name == "Jon Gashi **"  # type: ignore[attr-defined]


def test_dry_run_skips_db_writes(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(id_=1, name="Rita Hoxha", dob="01.02.2010")]
    report, _, _ = _import(rows, db=db, tmp_path=tmp_path, dry_run=True)

    assert report.imported == 1
    assert db.calls == []  # dry-run never touches the DB


# ---------------------------------------------------------------------------
# Orphan paths
# ---------------------------------------------------------------------------


def test_unparseable_dob_orphans_with_row(tmp_path: Path) -> None:
    """Date that's not in any known format, and not rescuable via the
    Vendi swap, lands in the dob_unparseable bucket (ADR-015)."""
    rows = [_row(id_=42, name="Rita Hoxha", dob="not a date")]
    report, warnings, orphans = _import(rows, db=CapturingDB(), tmp_path=tmp_path)

    assert report.imported == 0
    assert report.skipped_orphan == 1
    assert report.warnings_by_code["dob_unparseable"] == 1
    assert any(w["code"] == "dob_unparseable" for w in warnings)
    assert orphans[0]["reason"] == "dob_unparseable"
    assert orphans[0]["legacy_id"] == 42
    # The row content stays in the orphans file so the doctor can
    # re-enter the patient manually.
    assert orphans[0]["row"]["Emri dhe mbiemri"] == "Rita Hoxha"


def test_year_only_dob_orphan_has_distinct_reason(tmp_path: Path) -> None:
    """ADR-015: 'Datelindja=YYYY' rows orphan with reason
    `year_only_dob`, not `dob_unparseable`, so the post-cutover
    review queue can be triaged separately."""
    rows = [_row(id_=99, name="Rita Hoxha", dob="2018")]
    report, _, orphans = _import(rows, db=CapturingDB(), tmp_path=tmp_path)
    assert report.skipped_orphan == 1
    assert report.warnings_by_code["year_only_dob"] == 1
    assert orphans[0]["reason"] == "year_only_dob"


def test_dob_missing_distinct_from_unparseable(tmp_path: Path) -> None:
    """Datelindja absent / blank => `dob_missing` (ADR-015)."""
    rows = [_row(id_=99, name="Rita Hoxha", dob=None)]
    report, _, orphans = _import(rows, db=CapturingDB(), tmp_path=tmp_path)
    assert orphans[0]["reason"] == "dob_missing"
    assert report.warnings_by_code["dob_missing"] == 1


def test_vendi_swap_recovery_imports_row(tmp_path: Path) -> None:
    """ADR-015: when Vendi holds a parseable DD.MM.YYYY and
    Datelindja holds a city name, swap them. Row imports with the
    DOB from Vendi and place_of_birth from Datelindja, plus a
    `field_swap_recovered` warning."""
    db = CapturingDB()
    rows = [_row(id_=99, name="Lorian Xhemaj", dob="Prizren", place="02.11.2021")]
    report, warnings, orphans = _import(rows, db=db, tmp_path=tmp_path)

    assert orphans == []
    assert report.imported == 1
    assert any(w["code"] == "field_swap_recovered" for w in warnings)
    payload = db.calls[0][1]
    assert payload.date_of_birth == date(2021, 11, 2)  # type: ignore[attr-defined]
    assert payload.place_of_birth == "Prizren"  # type: ignore[attr-defined]


def test_vendi_swap_requires_dob_shape_not_just_any_date(tmp_path: Path) -> None:
    """Conservative gate: Vendi must look like a DOB (DD.MM.YYYY).
    Cities and free text never accidentally pass."""
    rows = [_row(id_=99, name="Rita Hoxha", dob="garbage", place="Prizren")]
    report, _, orphans = _import(rows, db=CapturingDB(), tmp_path=tmp_path)
    assert report.skipped_orphan == 1
    assert orphans[0]["reason"] == "dob_unparseable"


def test_missing_name_orphans(tmp_path: Path) -> None:
    rows = [_row(id_=1, name="", dob="01.02.2010")]
    report, _, orphans = _import(rows, db=CapturingDB(), tmp_path=tmp_path)

    assert report.imported == 0
    assert report.skipped_orphan == 1
    assert orphans[0]["reason"] == "name_unparseable"


def test_single_word_name_orphans(tmp_path: Path) -> None:
    """A single-token name is junk data — flagged as
    name_unparseable rather than imported with empty last_name."""
    rows = [_row(id_=1, name="Pacient", dob="01.02.2010")]
    report, _, orphans = _import(rows, db=CapturingDB(), tmp_path=tmp_path)

    assert report.imported == 0
    assert orphans[0]["reason"] == "name_unparseable"


def test_missing_legacy_id_orphans(tmp_path: Path) -> None:
    rows = [_row(id_=0, name="Rita Hoxha", dob="01.02.2010")]
    report, _, orphans = _import(rows, db=CapturingDB(), tmp_path=tmp_path)

    assert report.skipped_orphan == 1
    assert orphans[0]["reason"] == "missing_legacy_id"


# ---------------------------------------------------------------------------
# Non-blocking parse warnings (row still imports)
# ---------------------------------------------------------------------------


def test_bad_birth_weight_warns_but_imports(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(id_=1, name="Rita Hoxha", dob="01.02.2010", pl="garbage")]
    report, warnings, _ = _import(rows, db=db, tmp_path=tmp_path)

    assert report.imported == 1
    assert report.parse_warnings == 1
    assert any(w["code"] == "birth_weight_unparseable" for w in warnings)
    payload = db.calls[0][1]
    assert payload.birth_weight_g is None  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Batch behaviour
# ---------------------------------------------------------------------------


def test_mixed_batch_counters(tmp_path: Path) -> None:
    rows = [
        _row(id_=1, name="Rita Hoxha", dob="01.02.2010"),
        _row(id_=2, name="Jon Gashi *", dob="03.04.2011"),
        _row(id_=3, name="Bad Patient", dob="????"),
        _row(id_=4, name="Ana Maria Hoxha", dob="01.01.2008"),
    ]
    report, _, _ = _import(rows, db=CapturingDB(), tmp_path=tmp_path)

    assert report.source_rows == 4
    assert report.imported == 3
    assert report.skipped_orphan == 1
    assert report.duplicate_names == 1
