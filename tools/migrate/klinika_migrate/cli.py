"""CLI dispatch for the migration tool.

Subcommands:

  patients --config CFG [--dry-run|--commit]   STEP 2
  visits   --config CFG [--dry-run|--commit]   STEP 3 (not yet implemented)
  report   --config CFG --output REPORT.json   STEP 4 (not yet implemented)

The flag defaults follow ADR-010's safety convention: `--dry-run` is
on unless the operator explicitly opts into `--commit`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .access import AccessReader
from .config import load_config
from .db import Database
from .logger import get_logger
from .patients import import_patients
from .reports import JsonlWriter, write_summary_report


def _add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--config",
        required=True,
        type=Path,
        help="Path to config.yaml (see config.example.yaml)",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Validate + parse, no DB writes (default)")
    mode.add_argument("--commit", action="store_true", help="Actually write to the target database")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="klinika-migrate",
        description="Klinika Access -> Postgres migration (ADR-010).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    patients = sub.add_parser("patients", help="Import Pacientet (STEP 2)")
    _add_common_args(patients)

    visits = sub.add_parser("visits", help="Import Vizitat (STEP 3, not yet implemented)")
    _add_common_args(visits)

    report = sub.add_parser("report", help="Re-emit reconciliation report (STEP 4, not yet implemented)")
    report.add_argument("--config", required=True, type=Path)
    report.add_argument("--output", required=True, type=Path)

    return parser


def _resolve_dry_run(args: argparse.Namespace, default: bool) -> bool:
    if args.commit:
        return False
    if args.dry_run:
        return True
    return default


def cmd_patients(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    dry_run = _resolve_dry_run(args, default=cfg.options.dry_run)
    log_dir = cfg.options.log_dir
    logger = get_logger(log_dir)
    logger.info(
        "cli.patients",
        extra={"dry_run": dry_run, "source": str(cfg.source.path), "clinic": cfg.target.clinic_subdomain},
    )

    with Database.open(cfg.target.dsn, dry_run=dry_run) as db:
        clinic_id = db.resolve_clinic_id(cfg.target.clinic_subdomain)
        with AccessReader.open(cfg.source.path, cfg.source.odbc_driver) as reader:
            with JsonlWriter(log_dir / "warnings.jsonl") as warnings, \
                 JsonlWriter(log_dir / "orphans.jsonl") as orphans:
                report = import_patients(
                    reader,
                    db,
                    clinic_id,
                    dry_run=dry_run,
                    logger=logger,
                    warnings_writer=warnings,
                    orphans_writer=orphans,
                )
        write_summary_report(
            log_dir / "migration-report.json",
            phase="patients",
            dry_run=dry_run,
            patients=report,
        )

    logger.info(
        "cli.patients.done",
        extra={
            "imported": report.imported,
            "skipped_orphan": report.skipped_orphan,
            "parse_warnings": report.parse_warnings,
            "duplicate_names": report.duplicate_names,
            "log_dir": str(log_dir),
        },
    )
    return 0


def cmd_visits(_args: argparse.Namespace) -> int:
    print("visits import — implemented in STEP 3", file=sys.stderr)
    return 2


def cmd_report(_args: argparse.Namespace) -> int:
    print("report — implemented in STEP 4", file=sys.stderr)
    return 2


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    match args.command:
        case "patients":
            return cmd_patients(args)
        case "visits":
            return cmd_visits(args)
        case "report":
            return cmd_report(args)
        case _:
            parser.print_help(sys.stderr)
            return 2
