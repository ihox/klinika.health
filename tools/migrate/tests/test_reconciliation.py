"""Unit tests for the reconciliation reporter (STEP 4).

Covers the verdict logic (PASS / FAIL across every drift dimension)
and the report-payload shape (so any field renaming gets caught here
before it breaks runbooks).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from klinika_migrate.reconciliation import ORPHAN_RATE_THRESHOLD_PCT, reconcile


class StubDB:
    def __init__(
        self,
        *,
        patient_count: int = 0,
        visit_count: int = 0,
        duplicate_names: int = 0,
        date_range: tuple[date | None, date | None] = (None, None),
        payment_histogram: dict[str, int] | None = None,
    ) -> None:
        self._patient_count = patient_count
        self._visit_count = visit_count
        self._duplicate_names = duplicate_names
        self._date_range = date_range
        self._payment_histogram = payment_histogram or {}

    def count_migrated_patients(self, _clinic: str) -> int:
        return self._patient_count

    def count_duplicate_name_patients(self, _clinic: str) -> int:
        return self._duplicate_names

    def count_migrated_visits(self, _clinic: str) -> int:
        return self._visit_count

    def visit_date_range(self, _clinic: str) -> tuple[date | None, date | None]:
        return self._date_range

    def payment_code_histogram(self, _clinic: str) -> dict[str, int]:
        return dict(self._payment_histogram)


def _write_patient_report(log_dir: Path, imported: int, skipped: int, source: int = 11165) -> None:
    (log_dir / "migration-report-patients.json").write_text(json.dumps({
        "phase": "patients",
        "patients": {
            "source_rows": source,
            "imported": imported,
            "skipped_orphan": skipped,
            "parse_warnings": 0,
            "duplicate_names": 0,
            "warnings_by_code": {},
        },
    }))


def _write_visit_report(log_dir: Path, imported: int, skipped: int, source: int = 220466) -> None:
    (log_dir / "migration-report-visits.json").write_text(json.dumps({
        "phase": "visits",
        "visits": {
            "source_rows": source,
            "imported": imported,
            "skipped_orphan": skipped,
            "parse_warnings": 0,
            "warnings_by_code": {},
        },
    }))


# ---------------------------------------------------------------------------
# PASS path
# ---------------------------------------------------------------------------


def test_clean_run_returns_pass(tmp_path: Path) -> None:
    _write_patient_report(tmp_path, imported=11163, skipped=2)
    _write_visit_report(tmp_path, imported=218234, skipped=2232)
    db = StubDB(
        patient_count=11163,
        visit_count=218234,
        duplicate_names=462,
        date_range=(date(2010, 1, 1), date(2026, 5, 1)),
        payment_histogram={"A": 100000, "B": 50000, "C": 40000, "D": 20000, "∅": 8234},
    )
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")

    assert payload["verdict"] == "PASS"
    assert payload["verdict_reasons"] == []
    assert payload["patients"]["drift"]["tool_minus_db"] == 0
    assert payload["visits"]["drift"]["tool_minus_db"] == 0
    # Orphan rates inside the threshold.
    assert payload["patients"]["orphan_rate_pct"] < ORPHAN_RATE_THRESHOLD_PCT
    assert payload["visits"]["orphan_rate_pct"] < ORPHAN_RATE_THRESHOLD_PCT
    # The unified report file actually landed on disk.
    assert (tmp_path / "out.json").exists()


# ---------------------------------------------------------------------------
# FAIL paths — one per drift dimension
# ---------------------------------------------------------------------------


def test_tool_minus_db_drift_fails(tmp_path: Path) -> None:
    _write_patient_report(tmp_path, imported=11163, skipped=2)
    _write_visit_report(tmp_path, imported=218234, skipped=2232)
    db = StubDB(patient_count=11160, visit_count=218234)  # patients short of tool
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")

    assert payload["verdict"] == "FAIL"
    assert any("patients" in reason and "11160" in reason for reason in payload["verdict_reasons"])


def test_db_minus_tool_drift_fails(tmp_path: Path) -> None:
    _write_patient_report(tmp_path, imported=11163, skipped=2)
    _write_visit_report(tmp_path, imported=218234, skipped=2232)
    # DB has more rows than the tool claimed — leftover / external writes.
    db = StubDB(patient_count=11163, visit_count=220000)
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")
    assert payload["verdict"] == "FAIL"
    assert any("pre-existing" in reason for reason in payload["verdict_reasons"])


def test_orphan_rate_above_threshold_fails(tmp_path: Path) -> None:
    # 5% orphan rate > 2% threshold.
    _write_patient_report(tmp_path, imported=10000, skipped=600, source=10600)
    _write_visit_report(tmp_path, imported=218234, skipped=2232)
    db = StubDB(patient_count=10000, visit_count=218234)
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")
    assert payload["verdict"] == "FAIL"
    assert any("orphan rate" in reason for reason in payload["verdict_reasons"])


def test_missing_per_phase_reports_fails(tmp_path: Path) -> None:
    db = StubDB()
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")
    assert payload["verdict"] == "FAIL"
    assert payload["patients"] is None
    assert payload["visits"] is None
    assert len(payload["verdict_reasons"]) == 2


# ---------------------------------------------------------------------------
# Orphan aggregation from JSONL
# ---------------------------------------------------------------------------


def test_orphans_aggregated_by_reason(tmp_path: Path) -> None:
    _write_patient_report(tmp_path, imported=11163, skipped=2)
    _write_visit_report(tmp_path, imported=218234, skipped=3)
    (tmp_path / "visits-orphans.jsonl").write_text("\n".join([
        json.dumps({"reason": "patient_not_found", "legacy_id": 1}),
        json.dumps({"reason": "patient_not_found", "legacy_id": 2}),
        json.dumps({"reason": "visit_date_unparseable", "legacy_id": 3}),
    ]))
    db = StubDB(patient_count=11163, visit_count=218234)
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")
    assert payload["visits"]["orphans_by_reason"] == {
        "patient_not_found": 2,
        "visit_date_unparseable": 1,
    }


def test_malformed_jsonl_line_counted_not_crash(tmp_path: Path) -> None:
    _write_patient_report(tmp_path, imported=11163, skipped=1)
    _write_visit_report(tmp_path, imported=218234, skipped=0)
    (tmp_path / "orphans.jsonl").write_text("not valid json\n")
    db = StubDB(patient_count=11163, visit_count=218234)
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")
    assert payload["patients"]["orphans_by_reason"] == {"__malformed_jsonl_line": 1}


# ---------------------------------------------------------------------------
# Distribution checks
# ---------------------------------------------------------------------------


def test_distribution_section_populated(tmp_path: Path) -> None:
    _write_patient_report(tmp_path, imported=11163, skipped=2)
    _write_visit_report(tmp_path, imported=218234, skipped=2232)
    db = StubDB(
        patient_count=11163,
        visit_count=218234,
        duplicate_names=462,
        date_range=(date(2010, 1, 1), date(2026, 5, 1)),
        payment_histogram={"A": 100, "B": 50},
    )
    payload = reconcile(log_dir=tmp_path, db=db, clinic_id="cid", output_path=tmp_path / "out.json")
    dist = payload["distribution"]
    assert dist["duplicate_name_patients"] == 462
    assert dist["visit_date_range"]["min"] == "2010-01-01"
    assert dist["visit_date_range"]["max"] == "2026-05-01"
    assert dist["payment_code_distribution"] == {"A": 100, "B": 50}
