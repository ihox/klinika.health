"""STEP 4 — cross-phase migration reconciliation.

Consolidates the patient + visit per-phase JSON reports with live DB
counts and aggregates orphan / warning details, then emits a single
`migration-report.json` and prints a top-line GO/NO-GO verdict.

Drift cases the verdict watches for:

  source - tool   = orphans + parse-skipped rows (expected, bounded)
  tool   - db     = inserts the tool claimed but never landed
  db     - tool   = rows in the DB the tool did not place (pre-existing)

PASS verdict requires:
  - tool == db for both phases
  - db - tool == 0 (no leftover rows from prior runs / manual writes)
  - orphan rate < 2% per phase
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .db import Database


ORPHAN_RATE_THRESHOLD_PCT = 2.0


@dataclass(frozen=True)
class PhaseReconciliation:
    source_rows: int
    tool_imported: int
    tool_skipped_orphan: int
    tool_parse_warnings: int
    db_count: int
    warnings_by_code: dict[str, int]
    orphans_by_reason: dict[str, int]

    @property
    def orphan_rate_pct(self) -> float:
        if self.source_rows == 0:
            return 0.0
        return round(100.0 * self.tool_skipped_orphan / self.source_rows, 3)

    @property
    def source_minus_tool(self) -> int:
        return self.source_rows - self.tool_imported

    @property
    def tool_minus_db(self) -> int:
        return self.tool_imported - self.db_count

    @property
    def db_minus_tool(self) -> int:
        return self.db_count - self.tool_imported


def _load_phase_report(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _aggregate_orphans(path: Path) -> dict[str, int]:
    if not path.exists():
        return {}
    counts: Counter[str] = Counter()
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            counts["__malformed_jsonl_line"] += 1
            continue
        reason = str(record.get("reason", "unknown"))
        counts[reason] += 1
    return dict(counts)


def _build_phase(
    *,
    report: dict[str, Any] | None,
    phase_key: str,
    db_count: int,
    orphans_path: Path,
) -> PhaseReconciliation | None:
    """Build a PhaseReconciliation from the per-phase JSON + DB count."""
    if report is None:
        return None
    section = report.get(phase_key) or {}
    return PhaseReconciliation(
        source_rows=int(section.get("source_rows", 0)),
        tool_imported=int(section.get("imported", 0)),
        tool_skipped_orphan=int(section.get("skipped_orphan", 0)),
        tool_parse_warnings=int(section.get("parse_warnings", 0)),
        db_count=db_count,
        warnings_by_code=dict(section.get("warnings_by_code") or {}),
        orphans_by_reason=_aggregate_orphans(orphans_path),
    )


def _phase_to_dict(phase: PhaseReconciliation | None) -> dict[str, Any] | None:
    if phase is None:
        return None
    return {
        "source_rows": phase.source_rows,
        "tool_imported": phase.tool_imported,
        "tool_skipped_orphan": phase.tool_skipped_orphan,
        "tool_parse_warnings": phase.tool_parse_warnings,
        "db_count": phase.db_count,
        "orphan_rate_pct": phase.orphan_rate_pct,
        "drift": {
            "source_minus_tool": phase.source_minus_tool,
            "tool_minus_db": phase.tool_minus_db,
            "db_minus_tool": phase.db_minus_tool,
        },
        "warnings_by_code": phase.warnings_by_code,
        "orphans_by_reason": phase.orphans_by_reason,
    }


def _verdict(
    patients: PhaseReconciliation | None,
    visits: PhaseReconciliation | None,
) -> tuple[str, list[str]]:
    """Compute GO/NO-GO verdict and the list of reasons (empty if PASS)."""
    reasons: list[str] = []

    if patients is None:
        reasons.append("patients phase has not run (no migration-report-patients.json)")
    if visits is None:
        reasons.append("visits phase has not run (no migration-report-visits.json)")

    for label, phase in (("patients", patients), ("visits", visits)):
        if phase is None:
            continue
        if phase.tool_minus_db != 0:
            reasons.append(
                f"{label}: tool reported {phase.tool_imported} imports but DB shows {phase.db_count} "
                f"(tool - db = {phase.tool_minus_db})"
            )
        if phase.db_minus_tool > 0:
            reasons.append(
                f"{label}: DB has {phase.db_minus_tool} more rows than the tool placed "
                "(pre-existing data or external writes)"
            )
        if phase.orphan_rate_pct > ORPHAN_RATE_THRESHOLD_PCT:
            reasons.append(
                f"{label}: orphan rate {phase.orphan_rate_pct}% exceeds {ORPHAN_RATE_THRESHOLD_PCT}% threshold"
            )

    return ("PASS" if not reasons else "FAIL", reasons)


def reconcile(
    *,
    log_dir: Path,
    db: "Database",
    clinic_id: str,
    output_path: Path,
) -> dict[str, Any]:
    """Read the per-phase reports, query the DB, write the unified report."""
    patients_report = _load_phase_report(log_dir / "migration-report-patients.json")
    visits_report = _load_phase_report(log_dir / "migration-report-visits.json")

    patients_db_count = db.count_migrated_patients(clinic_id)
    visits_db_count = db.count_migrated_visits(clinic_id)
    duplicate_names = db.count_duplicate_name_patients(clinic_id)
    visit_min, visit_max = db.visit_date_range(clinic_id)
    payment_histogram = db.payment_code_histogram(clinic_id)

    patients = _build_phase(
        report=patients_report,
        phase_key="patients",
        db_count=patients_db_count,
        orphans_path=log_dir / "orphans.jsonl",
    )
    visits = _build_phase(
        report=visits_report,
        phase_key="visits",
        db_count=visits_db_count,
        orphans_path=log_dir / "visits-orphans.jsonl",
    )

    verdict, reasons = _verdict(patients, visits)

    payload: dict[str, Any] = {
        "phase": "report",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "verdict": verdict,
        "verdict_reasons": reasons,
        "clinic_id": clinic_id,
        "patients": _phase_to_dict(patients),
        "visits": _phase_to_dict(visits),
        "distribution": {
            "duplicate_name_patients": duplicate_names,
            "visit_date_range": {
                "min": visit_min.isoformat() if visit_min else None,
                "max": visit_max.isoformat() if visit_max else None,
            },
            "payment_code_distribution": payment_histogram,
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload
