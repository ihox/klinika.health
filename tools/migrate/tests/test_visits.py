"""Integration-style tests for the visit-import phase.

Exercises every branch in visits.py against a stub Access reader,
including the ADR-012 preflight cardinality probes.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

import pytest

from klinika_migrate.reports import JsonlWriter, VisitImportReport
from klinika_migrate.visits import (
    PATIENT_CARDINALITY_MAX,
    PATIENT_CARDINALITY_MIN,
    PAYMENT_CARDINALITY_MAX,
    import_visits,
    run_preflight_checks,
)
from tests.conftest import StubReader


PATIENT_RITA = "11111111-1111-1111-1111-111111111111"
PATIENT_JON = "22222222-2222-2222-2222-222222222222"

PATIENT_LOOKUP = {
    "Rita Hoxha*": PATIENT_RITA,
    "Jon Gashi **": PATIENT_JON,
}


def _row(**overrides: object) -> dict[str, object | None]:
    """Build a Vizitat-shaped row with sensible defaults."""
    base: dict[str, object | None] = {
        "ID": 1,
        "Data": "03/14/22",
        "Ushqimi": None,
        "Ankesa": None,
        "Ekzaminimet": None,
        "Ultrazeri": None,
        "Temp": None,
        "PT": None,
        "PK": None,
        "GJT": None,
        "Diagnoza": None,
        "Terapia": None,
        "Analizat": None,
        "Kontrolla": None,
        "Tjera": None,
        "x": "Rita Hoxha*",
        "ALERT": None,
    }
    base.update(overrides)
    return base


class CapturingDB:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object]] = []

    def upsert_visit(self, clinic_id: str, user_id: str, payload: object) -> str:  # noqa: ANN401
        self.calls.append((clinic_id, user_id, payload))
        return f"visit-{len(self.calls)}"


def _run(
    rows: list[dict],
    *,
    tmp_path: Path,
    db: CapturingDB | None = None,
    dry_run: bool = False,
) -> tuple[VisitImportReport, list[dict], list[dict]]:
    reader = StubReader({"Vizitat": rows})
    w = JsonlWriter(tmp_path / "w.jsonl")
    o = JsonlWriter(tmp_path / "o.jsonl")
    log = logging.getLogger("test")
    try:
        report = import_visits(
            reader,
            db,  # type: ignore[arg-type]
            clinic_id="cid-1",
            migration_user_id="user-1",
            patient_lookup=PATIENT_LOOKUP,
            dry_run=dry_run,
            logger=log,
            warnings_writer=w,
            orphans_writer=o,
        )
    finally:
        w.close()
        o.close()

    warnings = [json.loads(line) for line in (tmp_path / "w.jsonl").read_text().splitlines() if line.strip()]
    orphans = [json.loads(line) for line in (tmp_path / "o.jsonl").read_text().splitlines() if line.strip()]
    return report, warnings, orphans


# ---------------------------------------------------------------------------
# Happy paths — full field mapping per ADR-012
# ---------------------------------------------------------------------------


def test_full_field_mapping(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [
        _row(
            ID=10,
            Data="03/14/22",
            Ushqimi="i rregullt",
            Ankesa="kollë",
            Ekzaminimet="gusha e qartë",
            Ultrazeri="normale",
            Temp="37.2",
            PT="12500",
            PK="45",
            GJT="85",
            Diagnoza="Faringitis",
            Terapia="Paracetamol",
            Analizat="Hemogram",
            Kontrolla="s.n.",
            Tjera="A",
            x="Rita Hoxha*",
            ALERT="",
        )
    ]
    report, warnings, _ = _run(rows, db=db, tmp_path=tmp_path)

    assert report.imported == 1
    assert warnings == []
    _, _, p = db.calls[0]
    assert p.patient_id == PATIENT_RITA  # type: ignore[attr-defined]
    assert p.visit_date == date(2022, 3, 14)  # type: ignore[attr-defined]
    assert p.complaint == "kollë"  # type: ignore[attr-defined]
    assert p.feeding_notes == "i rregullt"  # type: ignore[attr-defined]
    assert p.ultrasound_notes == "normale"  # type: ignore[attr-defined]
    # Therapy -> prescription, analyses -> lab_results (ADR-012)
    assert p.prescription == "Paracetamol"  # type: ignore[attr-defined]
    assert p.lab_results == "Hemogram"  # type: ignore[attr-defined]
    assert p.legacy_diagnosis == "Faringitis"  # type: ignore[attr-defined]
    assert p.followup_notes == "s.n."  # type: ignore[attr-defined]
    assert p.payment_code == "A"  # type: ignore[attr-defined]
    assert p.other_notes is None  # empty ALERT -> NULL  # type: ignore[attr-defined]


def test_alert_prefix_when_present(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(ID=1, ALERT="Alergji ndaj penicilinës")]
    _, _, _ = _run(rows, db=db, tmp_path=tmp_path)
    p = db.calls[0][2]
    assert p.other_notes == "ALERT: Alergji ndaj penicilinës"  # type: ignore[attr-defined]


def test_payment_code_e_dropped(tmp_path: Path) -> None:
    """ADR-012 carve-out: payment code 'E' has unknown semantics, so
    it imports as NULL with a warning rather than as-is."""
    db = CapturingDB()
    rows = [_row(ID=1, Tjera="E")]
    report, warnings, _ = _run(rows, db=db, tmp_path=tmp_path)
    assert report.imported == 1
    p = db.calls[0][2]
    assert p.payment_code is None  # type: ignore[attr-defined]
    assert any(w["code"] == "payment_code_e_dropped" for w in warnings)


def test_payment_code_unknown(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(ID=1, Tjera="Q")]
    report, warnings, _ = _run(rows, db=db, tmp_path=tmp_path)
    assert report.imported == 1
    p = db.calls[0][2]
    assert p.payment_code is None  # type: ignore[attr-defined]
    assert any(w["code"] == "payment_code_unknown" for w in warnings)


def test_payment_code_known_letters_passthrough(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(ID=i, Tjera=letter) for i, letter in enumerate("ABCD", start=1)]
    report, warnings, _ = _run(rows, db=db, tmp_path=tmp_path)
    assert report.imported == 4
    codes = [call[2].payment_code for call in db.calls]  # type: ignore[attr-defined]
    assert codes == ["A", "B", "C", "D"]
    assert warnings == []


# ---------------------------------------------------------------------------
# Orphan paths
# ---------------------------------------------------------------------------


def test_patient_not_found_orphan(tmp_path: Path) -> None:
    rows = [_row(ID=1, x="Unknown Person")]
    report, _, orphans = _run(rows, tmp_path=tmp_path)
    assert report.imported == 0
    assert report.skipped_orphan == 1
    assert orphans[0]["reason"] == "patient_not_found"
    assert orphans[0]["row"]["x"] == "Unknown Person"


def test_missing_patient_name_orphan(tmp_path: Path) -> None:
    rows = [_row(ID=1, x=None)]
    report, _, orphans = _run(rows, tmp_path=tmp_path)
    assert report.skipped_orphan == 1
    assert orphans[0]["reason"] == "missing_patient_name"


def test_unparseable_visit_date_orphan(tmp_path: Path) -> None:
    rows = [_row(ID=1, Data="not a date")]
    report, _, orphans = _run(rows, tmp_path=tmp_path)
    assert report.skipped_orphan == 1
    assert orphans[0]["reason"] == "visit_date_unparseable"


def test_missing_legacy_id_orphan(tmp_path: Path) -> None:
    rows = [_row(ID=0)]
    report, _, orphans = _run(rows, tmp_path=tmp_path)
    assert report.skipped_orphan == 1
    assert orphans[0]["reason"] == "missing_legacy_id"


# ---------------------------------------------------------------------------
# Measurement parse warnings (row still imports)
# ---------------------------------------------------------------------------


def test_bad_weight_warns_but_imports(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(ID=1, PT="garbage")]
    report, warnings, _ = _run(rows, db=db, tmp_path=tmp_path)
    assert report.imported == 1
    assert any(w["code"] == "weight_unparseable" for w in warnings)


def test_dry_run_skips_db_writes(tmp_path: Path) -> None:
    db = CapturingDB()
    rows = [_row(ID=1)]
    report, _, _ = _run(rows, db=db, tmp_path=tmp_path, dry_run=True)
    assert report.imported == 1
    assert db.calls == []


# ---------------------------------------------------------------------------
# Preflight (ADR-012 cardinality probes)
# ---------------------------------------------------------------------------


def test_preflight_passes_with_valid_distribution() -> None:
    """A synthetic Vizitat with patient cardinality and payment
    cardinality inside the bounds should pass without raising."""
    rows = [
        {"x": f"Patient {i:05d}", "Tjera": "ABCD"[i % 4]}
        for i in range(PATIENT_CARDINALITY_MIN + 100)
    ]
    reader = StubReader({"Vizitat": rows})
    # If preflight passes, the call returns None.
    log = logging.getLogger("test")
    run_preflight_checks(reader, log)


def test_preflight_aborts_on_payment_cardinality_explosion() -> None:
    """Too many distinct Tjera values => ADR-012 says abort.
    Catches a future re-audit where the column moved."""
    rows = [
        {"x": f"Patient {i:05d}", "Tjera": f"code-{i}"}
        for i in range(PATIENT_CARDINALITY_MIN + 50)
    ]
    reader = StubReader({"Vizitat": rows})
    log = logging.getLogger("test")
    with pytest.raises(RuntimeError, match=r"Tjera"):
        run_preflight_checks(reader, log)


def test_preflight_aborts_on_patient_cardinality_too_low() -> None:
    """Too few distinct x values => ADR-012 says abort."""
    rows = [{"x": "Same Patient", "Tjera": "A"} for _ in range(100)]
    reader = StubReader({"Vizitat": rows})
    log = logging.getLogger("test")
    with pytest.raises(RuntimeError, match=r"\bx\b"):
        run_preflight_checks(reader, log)


def test_preflight_aborts_on_patient_cardinality_too_high() -> None:
    rows = [
        {"x": f"Patient {i:05d}", "Tjera": "A"}
        for i in range(PATIENT_CARDINALITY_MAX + 100)
    ]
    reader = StubReader({"Vizitat": rows})
    log = logging.getLogger("test")
    with pytest.raises(RuntimeError, match=r"\bx\b"):
        run_preflight_checks(reader, log)
