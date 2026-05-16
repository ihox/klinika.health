"""Slice 17.5 — apply-sex-inference unit + integration tests.

Covers:
  - dictionary loader: happy path, schema_version mismatch, culture
    mismatch, malformed values
  - apply_sex_dictionary: updates only the matching rows, honours the
    sex_inferred guard, is idempotent, stays inside the target clinic
  - audit_log row payload matches the slice-17.5 §3 spec

The DB is stubbed in-memory — we never touch Postgres here. The real
SQL is covered by the manual --commit run on the live DonetaMED DB
documented in the slice report.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from klinika_migrate.sex_inference import (
    DictionaryValidationError,
    SUPPORTED_CULTURE,
    SUPPORTED_SCHEMA_VERSION,
    apply_sex_dictionary,
    load_sex_dictionary,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_dict(path: Path, **overrides: Any) -> Path:
    payload: dict[str, Any] = {
        "schema_version": SUPPORTED_SCHEMA_VERSION,
        "culture": SUPPORTED_CULTURE,
        "name_count": 4,
        "names": {"Era": "f", "Arber": "m", "Rita": "f", "Drilon": "m"},
    }
    payload.update(overrides)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


@dataclass
class FakePatient:
    clinic_id: str
    legacy_id: int | None
    first_name: str
    sex: str | None = None
    sex_inferred: bool = False
    deleted_at: object | None = None


@dataclass
class StubDatabase:
    """In-memory stand-in for klinika_migrate.db.Database.

    Mirrors only the surface that apply_sex_dictionary needs:
      - apply_sex_for_names
      - count_null_sex_after_apply
      - write_sex_inference_audit_log
    """

    patients: list[FakePatient] = field(default_factory=list)
    audit_rows: list[dict[str, Any]] = field(default_factory=list)
    _next_audit_seq: int = 1

    def apply_sex_for_names(self, clinic_id: str, first_names: list[str], sex: str) -> int:
        if sex not in ("m", "f"):
            raise ValueError(sex)
        names = set(first_names)
        n = 0
        for p in self.patients:
            if p.clinic_id != clinic_id:
                continue
            if p.legacy_id is None:
                continue
            if p.sex is not None:
                continue
            if p.sex_inferred:
                continue
            if p.deleted_at is not None:
                continue
            if p.first_name not in names:
                continue
            p.sex = sex
            p.sex_inferred = True
            n += 1
        return n

    def count_null_sex_after_apply(self, clinic_id: str) -> int:
        return sum(
            1
            for p in self.patients
            if p.clinic_id == clinic_id
            and p.legacy_id is not None
            and p.sex is None
            and p.deleted_at is None
        )

    def write_sex_inference_audit_log(
        self,
        *,
        clinic_id: str,
        user_id: str,
        payload: dict[str, Any],
    ) -> str:
        audit_id = f"audit-{self._next_audit_seq}"
        self._next_audit_seq += 1
        self.audit_rows.append(
            {"id": audit_id, "clinic_id": clinic_id, "user_id": user_id, "changes": payload}
        )
        return audit_id


@pytest.fixture
def stub_db_with_patients() -> StubDatabase:
    db = StubDatabase()
    db.patients = [
        # In-scope migrated, eligible to flip.
        FakePatient(clinic_id="cid-a", legacy_id=1, first_name="Era"),
        FakePatient(clinic_id="cid-a", legacy_id=2, first_name="Arber"),
        FakePatient(clinic_id="cid-a", legacy_id=3, first_name="Drilon"),
        # Already-set sex must stay untouched (manual entry).
        FakePatient(clinic_id="cid-a", legacy_id=4, first_name="Rita", sex="m", sex_inferred=False),
        # sex_inferred=true with sex=NULL is the "Dr. Taulant explicitly
        # left it blank" state — also off-limits.
        FakePatient(
            clinic_id="cid-a",
            legacy_id=5,
            first_name="Era",
            sex=None,
            sex_inferred=True,
        ),
        # Post-migration UI-created (legacy_id is null) — off-limits.
        FakePatient(clinic_id="cid-a", legacy_id=None, first_name="Era"),
        # Soft-deleted — off-limits.
        FakePatient(clinic_id="cid-a", legacy_id=6, first_name="Rita", deleted_at="2026-01-01"),
        # Different clinic — must never be touched.
        FakePatient(clinic_id="cid-b", legacy_id=7, first_name="Era"),
        FakePatient(clinic_id="cid-b", legacy_id=8, first_name="Arber"),
        # Ambiguous / null-mapped name (no dictionary entry) — left null.
        FakePatient(clinic_id="cid-a", legacy_id=9, first_name="Sea"),
    ]
    return db


@pytest.fixture
def silent_logger() -> logging.Logger:
    log = logging.getLogger("test.sex_inference")
    log.setLevel(logging.CRITICAL)
    return log


# ---------------------------------------------------------------------------
# load_sex_dictionary
# ---------------------------------------------------------------------------


def test_load_sex_dictionary_happy_path(tmp_path: Path) -> None:
    path = _write_dict(tmp_path / "dict.json")
    d = load_sex_dictionary(path)
    assert d.schema_version == SUPPORTED_SCHEMA_VERSION
    assert d.culture == SUPPORTED_CULTURE
    assert d.name_count == 4
    assert d.names["Era"] == "f"
    assert d.names["Arber"] == "m"


def test_load_sex_dictionary_rejects_unsupported_schema_version(tmp_path: Path) -> None:
    # 999 is far enough out that we won't accidentally collide with a
    # legitimate future version added to SUPPORTED_SCHEMA_VERSIONS.
    path = _write_dict(tmp_path / "dict.json", schema_version=999)
    with pytest.raises(DictionaryValidationError, match="schema_version"):
        load_sex_dictionary(path)


def test_load_sex_dictionary_accepts_all_supported_versions(tmp_path: Path) -> None:
    from klinika_migrate.sex_inference import SUPPORTED_SCHEMA_VERSIONS

    for v in sorted(SUPPORTED_SCHEMA_VERSIONS):
        path = _write_dict(tmp_path / f"dict_v{v}.json", schema_version=v)
        d = load_sex_dictionary(path)
        assert d.schema_version == v


def test_load_sex_dictionary_rejects_wrong_culture(tmp_path: Path) -> None:
    path = _write_dict(tmp_path / "dict.json", culture="german_austrian")
    with pytest.raises(DictionaryValidationError, match="culture"):
        load_sex_dictionary(path)


def test_load_sex_dictionary_rejects_invalid_sex_value(tmp_path: Path) -> None:
    path = _write_dict(tmp_path / "dict.json", names={"Era": "X"})
    with pytest.raises(DictionaryValidationError, match="Invalid sex value"):
        load_sex_dictionary(path)


def test_load_sex_dictionary_rejects_missing_file(tmp_path: Path) -> None:
    with pytest.raises(DictionaryValidationError, match="not found"):
        load_sex_dictionary(tmp_path / "does-not-exist.json")


def test_load_sex_dictionary_accepts_null_entries(tmp_path: Path) -> None:
    path = _write_dict(tmp_path / "dict.json", names={"Era": "f", "Lori": None})
    d = load_sex_dictionary(path)
    assert d.names["Lori"] is None


# ---------------------------------------------------------------------------
# apply_sex_dictionary
# ---------------------------------------------------------------------------


def test_apply_updates_only_eligible_rows_and_writes_audit_log(
    stub_db_with_patients: StubDatabase,
    silent_logger: logging.Logger,
    tmp_path: Path,
) -> None:
    db = stub_db_with_patients
    dict_path = _write_dict(tmp_path / "dict.json")
    dictionary = load_sex_dictionary(dict_path)

    report = apply_sex_dictionary(
        db,
        clinic_id="cid-a",
        migration_user_id="uid-doc",
        dictionary=dictionary,
        dry_run=False,
        logger=silent_logger,
    )

    # Three legacy_id rows in cid-a have first_name in {Era, Arber, Drilon}
    # and are eligible. The Era row with sex_inferred=true must NOT count.
    # Rita is already sex=m → not touched. Sea is not in the dictionary.
    eras = [p for p in db.patients if p.clinic_id == "cid-a" and p.first_name == "Era"]
    eligible_era = [p for p in eras if p.legacy_id == 1]
    locked_era = [p for p in eras if p.legacy_id == 5]
    ui_era = [p for p in eras if p.legacy_id is None]
    assert eligible_era[0].sex == "f"
    assert eligible_era[0].sex_inferred is True
    assert locked_era[0].sex is None  # untouched — sex_inferred guard
    assert locked_era[0].sex_inferred is True
    assert ui_era[0].sex is None  # untouched — legacy_id IS NULL

    arber = next(p for p in db.patients if p.legacy_id == 2)
    drilon = next(p for p in db.patients if p.legacy_id == 3)
    rita_manual = next(p for p in db.patients if p.legacy_id == 4)
    rita_deleted = next(p for p in db.patients if p.legacy_id == 6)
    sea = next(p for p in db.patients if p.legacy_id == 9)
    assert arber.sex == "m"
    assert drilon.sex == "m"
    assert rita_manual.sex == "m"  # was already 'm'
    assert rita_manual.sex_inferred is False  # manual, stays manual
    assert rita_deleted.sex is None  # soft-deleted, untouched
    assert sea.sex is None  # not in dictionary

    # Other clinic stays untouched.
    for p in db.patients:
        if p.clinic_id != "cid-a":
            assert p.sex is None
            assert p.sex_inferred is False

    # Report numbers.
    assert report.patients_updated_male == 2  # Arber + Drilon
    assert report.patients_updated_female == 1  # Era
    # cid-a remaining-NULL: Era#5 (sex_inferred=true) + Era#null-legacy
    # is excluded because legacy_id IS NULL. Rita#6 is soft-deleted —
    # excluded. Sea#9 is still NULL. So 2 remain.
    assert report.patients_left_null == 2

    # Audit log payload matches the slice-17.5 §3 spec.
    assert len(db.audit_rows) == 1
    payload = db.audit_rows[0]["changes"]
    assert payload == {
        "event": "sex_inference_applied",
        "schema_version": SUPPORTED_SCHEMA_VERSION,
        "culture": SUPPORTED_CULTURE,
        "name_count": 4,
        "patients_updated_male": 2,
        "patients_updated_female": 1,
        "patients_left_null": 2,
        "dictionary_path": "tools/migrate/klinika_migrate/data/sex_dictionary_albanian_kosovan.json",
    }
    assert db.audit_rows[0]["clinic_id"] == "cid-a"
    assert db.audit_rows[0]["user_id"] == "uid-doc"


def test_apply_is_idempotent(
    stub_db_with_patients: StubDatabase,
    silent_logger: logging.Logger,
    tmp_path: Path,
) -> None:
    db = stub_db_with_patients
    dict_path = _write_dict(tmp_path / "dict.json")
    dictionary = load_sex_dictionary(dict_path)

    r1 = apply_sex_dictionary(
        db,
        clinic_id="cid-a",
        migration_user_id="uid-doc",
        dictionary=dictionary,
        dry_run=False,
        logger=silent_logger,
    )
    r2 = apply_sex_dictionary(
        db,
        clinic_id="cid-a",
        migration_user_id="uid-doc",
        dictionary=dictionary,
        dry_run=False,
        logger=silent_logger,
    )

    # First run does work; second run is a no-op on patient updates.
    assert r1.patients_updated_male + r1.patients_updated_female > 0
    assert r2.patients_updated_male == 0
    assert r2.patients_updated_female == 0
    # patients_left_null stays stable.
    assert r1.patients_left_null == r2.patients_left_null
    # Each run still writes its own audit_log row for traceability.
    assert len(db.audit_rows) == 2


def test_apply_skips_other_clinics(
    stub_db_with_patients: StubDatabase,
    silent_logger: logging.Logger,
    tmp_path: Path,
) -> None:
    db = stub_db_with_patients
    dictionary = load_sex_dictionary(_write_dict(tmp_path / "dict.json"))
    apply_sex_dictionary(
        db,
        clinic_id="cid-a",
        migration_user_id="uid-doc",
        dictionary=dictionary,
        dry_run=False,
        logger=silent_logger,
    )
    for p in db.patients:
        if p.clinic_id == "cid-b":
            assert p.sex is None
            assert p.sex_inferred is False


def test_apply_committed_dictionary_loads(tmp_path: Path) -> None:
    """Smoke test the on-disk dictionary in the package data dir.

    Catches accidental corruption of the JSON or a future drift from
    the supported schema_version/culture pins.
    """
    from klinika_migrate.cli import DEFAULT_SEX_DICTIONARY

    d = load_sex_dictionary(DEFAULT_SEX_DICTIONARY)
    assert d.schema_version == SUPPORTED_SCHEMA_VERSION
    assert d.culture == SUPPORTED_CULTURE
    # The committed dictionary covers ~2760 unique DonetaMED first
    # names; a smaller number means somebody truncated it.
    assert d.name_count >= 2700
    assert "Era" in d.names
    assert d.names["Era"] == "f"
