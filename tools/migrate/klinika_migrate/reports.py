"""Reconciliation report writers.

Per ADR-010, the migration emits a JSON reconciliation report
alongside two JSONL side-files:

  migration-report.json   summary counts + warning breakdown
  warnings.jsonl          one row per parse warning (field, legacy_id, code)
  orphans.jsonl           one row per skipped source row (with reason)

PHI handling: the JSONL files DO contain the raw source row content
because they are the doctor's review aid during cutover (he needs to
see "ah, that row had a typo, I'll re-enter it"). These files live in
log_dir, which must not be committed — same rule as .accdb itself.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class PatientImportReport:
    source_rows: int = 0
    imported: int = 0
    skipped_orphan: int = 0
    parse_warnings: int = 0
    duplicate_names: int = 0
    warnings_by_code: Counter[str] = field(default_factory=Counter)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_rows": self.source_rows,
            "imported": self.imported,
            "skipped_orphan": self.skipped_orphan,
            "parse_warnings": self.parse_warnings,
            "duplicate_names": self.duplicate_names,
            "warnings_by_code": dict(self.warnings_by_code),
        }


@dataclass
class VisitImportReport:
    source_rows: int = 0
    imported: int = 0
    skipped_orphan: int = 0
    parse_warnings: int = 0
    warnings_by_code: Counter[str] = field(default_factory=Counter)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_rows": self.source_rows,
            "imported": self.imported,
            "skipped_orphan": self.skipped_orphan,
            "parse_warnings": self.parse_warnings,
            "warnings_by_code": dict(self.warnings_by_code),
        }


class JsonlWriter:
    """Append-only JSONL writer used for warnings and orphans files."""

    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = path.open("w", encoding="utf-8")

    def write(self, record: dict[str, Any]) -> None:
        self._fh.write(json.dumps(record, ensure_ascii=False, default=str))
        self._fh.write("\n")

    def close(self) -> None:
        self._fh.close()

    def __enter__(self) -> "JsonlWriter":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()


def write_summary_report(
    path: Path,
    *,
    phase: str,
    dry_run: bool,
    patients: PatientImportReport | None = None,
    visits: VisitImportReport | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload: dict[str, Any] = {
        "phase": phase,
        "dry_run": dry_run,
    }
    if patients is not None:
        payload["patients"] = patients.to_dict()
    if visits is not None:
        payload["visits"] = visits.to_dict()
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
