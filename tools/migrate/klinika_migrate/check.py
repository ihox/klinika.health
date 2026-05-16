"""Environment self-test for the migration tool.

Runs every prerequisite the import phases need, in order, and prints a
single human-readable status line per check. Used by `migrate.py
check` so the operator catches setup problems (missing mdbtools, DSN
typos, role grants, wrong subdomain, etc.) before iterating on the
actual import.

Every check returns a `CheckResult` and the runner aggregates them so
one failure doesn't short-circuit the rest — the operator sees the
full picture in one pass. Exit code is non-zero iff any check failed.
"""

from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import psycopg

from .access import MDB_JSON_BIN
from .config import Config


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class CheckSuite:
    results: list[CheckResult] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.results.append(CheckResult(name=name, ok=ok, detail=detail))

    @property
    def all_ok(self) -> bool:
        return all(r.ok for r in self.results)


def _run(check: Callable[[], tuple[bool, str]], name: str, suite: CheckSuite) -> bool:
    """Wrap a check so a raised exception becomes a clean failure result."""
    try:
        ok, detail = check()
    except Exception as exc:  # noqa: BLE001 — we report every failure mode the same way
        suite.add(name, ok=False, detail=f"{type(exc).__name__}: {exc}")
        return False
    suite.add(name, ok=ok, detail=detail)
    return ok


def _check_mdb_json_binary() -> tuple[bool, str]:
    path = shutil.which(MDB_JSON_BIN)
    if path is None:
        return False, "mdb-json not on PATH (brew install mdbtools / apt install mdbtools)"
    # Version probe is cheap and confirms the binary is executable.
    result = subprocess.run([path, "--help"], capture_output=True, text=True)
    if result.returncode not in (0, 1):  # mdb-json --help exits 1 on some builds
        return False, f"mdb-json present but `--help` exited {result.returncode}"
    return True, path


def _check_accdb_file(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return False, f"not found: {path}"
    if not path.is_file():
        return False, f"not a regular file: {path}"
    size_mb = path.stat().st_size / (1024 * 1024)
    return True, f"{path} ({size_mb:.1f} MB)"


def _check_accdb_readable(path: Path) -> tuple[bool, str]:
    """Verify mdb-json can actually read the file. Catches both
    permissions issues and corrupt-file scenarios — neither would
    surface until iteration starts otherwise."""
    result = subprocess.run(
        [MDB_JSON_BIN, str(path), "Pacientet"],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.returncode != 0:
        return False, f"mdb-json exit {result.returncode}: {result.stderr.strip()[:200]}"
    # Count lines without materialising the whole stream (which would
    # be ~5 MB for Pacientet — fine, but unnecessary for a probe).
    n = sum(1 for line in result.stdout.splitlines() if line.strip())
    return True, f"Pacientet readable, {n} rows"


def _check_db_connect(dsn: str) -> tuple[bool, str]:
    if not dsn:
        return False, "target.dsn empty in config.yaml"
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SELECT current_user, current_database()")
            row = cursor.fetchone()
    if row is None:
        return False, "connect succeeded but SELECT current_user returned no row"
    user, db = row
    return True, f"connected as {user}@{db}"


def _check_set_role_platform_admin(dsn: str) -> tuple[bool, str]:
    """The single most common STEP 6 failure — surfaces in isolation
    so the operator gets a clear `make db-migrate` pointer instead of
    a half-formed error mid-import."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET ROLE platform_admin_role")
            cursor.execute("SELECT 1 FROM clinics LIMIT 1")
    return True, "SET ROLE + table access succeed"


def _check_clinic_exists(dsn: str, subdomain: str) -> tuple[bool, str]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET ROLE platform_admin_role")
            cursor.execute(
                "SELECT id, name FROM clinics WHERE subdomain = %s AND deleted_at IS NULL",
                (subdomain,),
            )
            row = cursor.fetchone()
    if row is None:
        return False, f"no clinic with subdomain={subdomain!r} (seed it first)"
    return True, f"id={row[0]}, name={row[1]!r}"


def _check_migration_user(dsn: str, subdomain: str, email: str | None) -> tuple[bool, str]:
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET ROLE platform_admin_role")
            cursor.execute(
                "SELECT id FROM clinics WHERE subdomain = %s AND deleted_at IS NULL",
                (subdomain,),
            )
            clinic_row = cursor.fetchone()
            if clinic_row is None:
                return False, "clinic not found; this check depends on the clinic check passing"
            clinic_id = clinic_row[0]
            if email:
                cursor.execute(
                    "SELECT id FROM users WHERE clinic_id = %s AND email = %s "
                    "AND deleted_at IS NULL AND is_active",
                    (clinic_id, email),
                )
                row = cursor.fetchone()
                if row is None:
                    return False, f"no active user {email!r} in clinic"
                return True, f"explicit user: {email}"
            cursor.execute(
                "SELECT email FROM users WHERE clinic_id = %s "
                "AND 'doctor' = ANY(roles) AND deleted_at IS NULL AND is_active "
                "ORDER BY created_at ASC LIMIT 1",
                (clinic_id,),
            )
            row = cursor.fetchone()
    if row is None:
        return False, "no active doctor in the clinic (seed first)"
    return True, f"auto-resolved doctor: {row[0]}"


def _check_clinic_wiped_or_idempotent(dsn: str, subdomain: str) -> tuple[bool, str]:
    """Soft check: report current row counts so the operator notices if
    a prior --commit already ran. Doesn't fail — idempotent re-runs
    are legitimate (ADR-010)."""
    with psycopg.connect(dsn, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute("SET ROLE platform_admin_role")
            cursor.execute(
                "SELECT id FROM clinics WHERE subdomain = %s AND deleted_at IS NULL",
                (subdomain,),
            )
            clinic_row = cursor.fetchone()
            if clinic_row is None:
                return True, "clinic not found (covered by the clinic check)"
            clinic_id = clinic_row[0]
            cursor.execute(
                "SELECT "
                "  (SELECT COUNT(*) FROM patients WHERE clinic_id = %s AND legacy_id IS NOT NULL), "
                "  (SELECT COUNT(*) FROM visits WHERE clinic_id = %s AND legacy_id IS NOT NULL)",
                (clinic_id, clinic_id),
            )
            patients, visits = cursor.fetchone()  # type: ignore[misc]
    if patients == 0 and visits == 0:
        return True, "clinic empty (fresh run)"
    return True, f"clinic already holds {patients} migrated patients + {visits} visits (re-run will upsert)"


def run_all_checks(cfg: Config) -> CheckSuite:
    """Run every check; return the aggregated suite."""
    suite = CheckSuite()
    if not _run(_check_mdb_json_binary, "mdbtools binary", suite):
        # Subsequent checks call mdb-json; without it everything fails.
        suite.add("(skipping accdb readability)", ok=True, detail="mdb-json missing")
        return _continue_db_only(cfg, suite)

    accdb_ok = _run(lambda: _check_accdb_file(cfg.source.path), "accdb file", suite)
    if accdb_ok:
        _run(lambda: _check_accdb_readable(cfg.source.path), "accdb readable", suite)

    return _continue_db_only(cfg, suite)


def _continue_db_only(cfg: Config, suite: CheckSuite) -> CheckSuite:
    db_ok = _run(lambda: _check_db_connect(cfg.target.dsn), "postgres connect", suite)
    if not db_ok:
        return suite
    role_ok = _run(
        lambda: _check_set_role_platform_admin(cfg.target.dsn),
        "SET ROLE platform_admin_role",
        suite,
    )
    if not role_ok:
        return suite
    clinic_ok = _run(
        lambda: _check_clinic_exists(cfg.target.dsn, cfg.target.clinic_subdomain),
        f"clinic {cfg.target.clinic_subdomain!r}",
        suite,
    )
    if clinic_ok:
        _run(
            lambda: _check_migration_user(
                cfg.target.dsn,
                cfg.target.clinic_subdomain,
                cfg.target.migration_user_email,
            ),
            "migration user",
            suite,
        )
        _run(
            lambda: _check_clinic_wiped_or_idempotent(
                cfg.target.dsn, cfg.target.clinic_subdomain
            ),
            "clinic state",
            suite,
        )
    return suite


def format_suite(suite: CheckSuite) -> str:
    """Render the suite as text for stdout — kept separate from
    `run_all_checks` so tests can inspect the structured results
    without parsing strings."""
    lines = []
    for r in suite.results:
        mark = "OK" if r.ok else "FAIL"
        lines.append(f"  [{mark:>4}] {r.name:<35} {r.detail}")
    lines.append("")
    lines.append(f"  {'ALL PASSED' if suite.all_ok else 'FAILURES DETECTED — fix above before --commit'}")
    return "\n".join(lines)
