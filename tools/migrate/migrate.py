"""Klinika Access -> Postgres migration tool (ADR-010).

Thin executable shim. All logic lives in the `klinika_migrate`
package; this file just sets up the import path and hands off to
`klinika_migrate.cli.main`.

Usage:
  python migrate.py patients    --config config.yaml [--commit]
  python migrate.py visits      --config config.yaml [--commit]
  python migrate.py report      --config config.yaml --output report.json
  python migrate.py wipe-clinic --config config.yaml [--clinic-id UUID|--clinic-subdomain X|--clinic-name X] [--commit]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from klinika_migrate.cli import main  # noqa: E402


if __name__ == "__main__":
    sys.exit(main())
