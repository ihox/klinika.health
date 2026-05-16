"""CLI dispatch for the migration tool.

Subcommands:

  check                 --config CFG
                          Environment self-test (mdbtools, DB connect,
                          role grants, clinic, migration user). Run
                          this before every cutover to catch setup
                          problems in isolation.
  patients              --config CFG [--dry-run|--commit]
  visits                --config CFG [--dry-run|--commit] [--skip-preflight]
  report                --config CFG [--output REPORT.json]
  apply-sex-inference   --config CFG [--dry-run|--commit] [--dictionary PATH]
                                                                  (Slice 17.5)

The flag defaults follow ADR-010's safety convention: `--dry-run` is
on unless the operator explicitly opts into `--commit`.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .access import AccessReader
from .check import format_suite, run_all_checks
from .config import load_config
from .db import Database
from .logger import get_logger
from .patients import import_patients
from .reconciliation import reconcile
from .reports import JsonlWriter, write_summary_report
from .sex_inference import (
    DICTIONARY_REPO_PATH,
    SUPPORTED_CULTURE,
    SUPPORTED_SCHEMA_VERSION,
    apply_sex_dictionary,
    load_sex_dictionary,
)
from .visits import import_visits, run_preflight_checks

# Default dictionary path: resolve `tools/migrate/klinika_migrate/data/...`
# relative to this file so the CLI works regardless of where the
# operator runs it from.
DEFAULT_SEX_DICTIONARY = Path(__file__).resolve().parent / "data" / "sex_dictionary_albanian_kosovan.json"


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

    check = sub.add_parser(
        "check",
        help="Environment self-test: mdbtools, DB connect, role grants, clinic seeded",
    )
    check.add_argument("--config", required=True, type=Path)

    patients = sub.add_parser("patients", help="Import Pacientet (STEP 2)")
    _add_common_args(patients)

    visits = sub.add_parser("visits", help="Import Vizitat (STEP 3)")
    _add_common_args(visits)
    visits.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip the ADR-012 cardinality probes (only safe on confirmed re-runs)",
    )

    report = sub.add_parser("report", help="Generate cross-phase reconciliation report")
    report.add_argument(
        "--config",
        required=True,
        type=Path,
        help="Path to config.yaml (see config.example.yaml)",
    )
    report.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output path. Defaults to <log_dir>/migration-report.json",
    )

    sex_inf = sub.add_parser(
        "apply-sex-inference",
        help="Slice 17.5: backfill patients.sex from a versioned name dictionary",
    )
    _add_common_args(sex_inf)
    sex_inf.add_argument(
        "--dictionary",
        type=Path,
        default=DEFAULT_SEX_DICTIONARY,
        help=(
            "Path to the versioned sex dictionary JSON. Defaults to the "
            "committed albanian_kosovan dictionary inside the package."
        ),
    )

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
        with AccessReader.open(cfg.source.path) as reader:
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
            log_dir / "migration-report-patients.json",
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


def cmd_visits(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    dry_run = _resolve_dry_run(args, default=cfg.options.dry_run)
    log_dir = cfg.options.log_dir
    logger = get_logger(log_dir)
    logger.info(
        "cli.visits",
        extra={
            "dry_run": dry_run,
            "source": str(cfg.source.path),
            "clinic": cfg.target.clinic_subdomain,
            "skip_preflight": bool(args.skip_preflight),
        },
    )

    with Database.open(cfg.target.dsn, dry_run=dry_run) as db:
        clinic_id = db.resolve_clinic_id(cfg.target.clinic_subdomain)
        migration_user_id = db.resolve_migration_user_id(clinic_id, cfg.target.migration_user_email)
        patient_lookup = db.load_patient_lookup(clinic_id)
        logger.info(
            "cli.visits.lookup_loaded",
            extra={"patient_lookup_size": len(patient_lookup)},
        )
        if not patient_lookup:
            raise RuntimeError(
                f"No migrated patients in clinic {cfg.target.clinic_subdomain}. "
                "Run `migrate.py patients --commit` first."
            )

        with AccessReader.open(cfg.source.path) as reader:
            if not args.skip_preflight:
                run_preflight_checks(reader, logger)
            with JsonlWriter(log_dir / "visits-warnings.jsonl") as warnings, \
                 JsonlWriter(log_dir / "visits-orphans.jsonl") as orphans:
                report = import_visits(
                    reader,
                    db,
                    clinic_id,
                    migration_user_id,
                    patient_lookup,
                    dry_run=dry_run,
                    logger=logger,
                    warnings_writer=warnings,
                    orphans_writer=orphans,
                )

        write_summary_report(
            log_dir / "migration-report-visits.json",
            phase="visits",
            dry_run=dry_run,
            visits=report,
        )

    logger.info(
        "cli.visits.done",
        extra={
            "imported": report.imported,
            "skipped_orphan": report.skipped_orphan,
            "parse_warnings": report.parse_warnings,
            "log_dir": str(log_dir),
        },
    )
    return 0


def cmd_apply_sex_inference(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    dry_run = _resolve_dry_run(args, default=cfg.options.dry_run)
    log_dir = cfg.options.log_dir
    logger = get_logger(log_dir)
    dictionary = load_sex_dictionary(args.dictionary)
    logger.info(
        "cli.apply_sex_inference",
        extra={
            "dry_run": dry_run,
            "clinic": cfg.target.clinic_subdomain,
            "dictionary_path": str(args.dictionary),
            "schema_version": dictionary.schema_version,
            "culture": dictionary.culture,
            "name_count": dictionary.name_count,
        },
    )

    with Database.open(cfg.target.dsn, dry_run=dry_run) as db:
        clinic_id = db.resolve_clinic_id(cfg.target.clinic_subdomain)
        migration_user_id = db.resolve_migration_user_id(clinic_id, cfg.target.migration_user_email)
        report = apply_sex_dictionary(
            db,
            clinic_id=clinic_id,
            migration_user_id=migration_user_id,
            dictionary=dictionary,
            dry_run=dry_run,
            logger=logger,
        )

    print("\nSex inference applied:")
    print(f"  schema_version:           {report.schema_version}")
    print(f"  culture:                  {report.culture}")
    print(f"  name_count:               {report.name_count}")
    print(f"  patients_updated_male:    {report.patients_updated_male}")
    print(f"  patients_updated_female:  {report.patients_updated_female}")
    print(f"  patients_left_null:       {report.patients_left_null}")
    print(f"  audit_log_id:             {report.audit_log_id}")
    print(f"  dictionary_repo_path:     {DICTIONARY_REPO_PATH}")
    print(f"  dry_run:                  {dry_run}")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    """Environment self-test. Returns 0 only if every check passes."""
    cfg = load_config(args.config)
    print(f"\nklinika-migrate check — clinic={cfg.target.clinic_subdomain!r}\n")
    suite = run_all_checks(cfg)
    print(format_suite(suite))
    return 0 if suite.all_ok else 1


def cmd_report(args: argparse.Namespace) -> int:
    cfg = load_config(args.config)
    log_dir = cfg.options.log_dir
    output_path = args.output if args.output else log_dir / "migration-report.json"
    logger = get_logger(log_dir)
    logger.info(
        "cli.report",
        extra={"output": str(output_path), "clinic": cfg.target.clinic_subdomain},
    )

    # The reconciliation step is read-only against the DB. We still
    # open the connection in dry-run mode so any accidental write in
    # this code path would roll back rather than land.
    with Database.open(cfg.target.dsn, dry_run=True) as db:
        clinic_id = db.resolve_clinic_id(cfg.target.clinic_subdomain)
        payload = reconcile(log_dir=log_dir, db=db, clinic_id=clinic_id, output_path=output_path)

    verdict = payload["verdict"]
    reasons: list[str] = payload["verdict_reasons"]
    print(f"\nVERDICT: {verdict}")
    if reasons:
        for reason in reasons:
            print(f"  - {reason}")
    print(f"\nReport: {output_path}")
    # Exit code mirrors the verdict so CI / runbooks can branch on it.
    return 0 if verdict == "PASS" else 1


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    match args.command:
        case "check":
            return cmd_check(args)
        case "patients":
            return cmd_patients(args)
        case "visits":
            return cmd_visits(args)
        case "report":
            return cmd_report(args)
        case "apply-sex-inference":
            return cmd_apply_sex_inference(args)
        case _:
            parser.print_help(sys.stderr)
            return 2
