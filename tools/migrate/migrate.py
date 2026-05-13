"""Klinika Access -> Postgres migration entry point.

Stub for slice-01. Real mapping logic lands in a later slice; see
docs/data-migration.md.
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="migrate", description="Klinika Access -> Postgres migrator (stub).")
    parser.add_argument("--config", required=True, help="Path to config.yaml")
    parser.add_argument("--source", required=True, help="Path to .accdb file (never committed)")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Profile and validate without writing")
    mode.add_argument("--execute", action="store_true", help="Apply migration to the target database")

    args = parser.parse_args(argv)
    print(f"klinika-migrate stub — config={args.config} source={args.source} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
