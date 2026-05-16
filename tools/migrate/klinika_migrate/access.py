"""Access (.accdb) reader for the migration tool.

Wraps `mdb-json` (from mdbtools 1.0+). Streams one JSON object per row,
which sidesteps the memo-field newline/comma issue that broke
ADR-010's original `mdb-export` CSV pipeline (ADR-014).

Why not pyodbc anymore: mdbtools 1.0 removed the ODBC driver
(`libmdbodbc`) and Homebrew now ships only the CLI tools. Going
through pyodbc would require building an older mdbtools from source
plus a unixODBC stack — fragile on macOS, no improvement over
`mdb-json`, which exists precisely to give callers a clean record
stream.

Tests stub this class out via the `AbstractReader` protocol so they
don't need an actual .accdb file (which carries PHI and is not
committed).
"""

from __future__ import annotations

import contextlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Iterator, Protocol


# mdbtools binary we depend on. Documented in requirements.txt as a
# system prerequisite (brew install mdbtools / apt install mdbtools).
#
# We deliberately do NOT depend on `mdb-count`: empirical comparison
# on PEDIATRIA.accdb (slice 17 STEP 6, 2026-05-17) showed
# `mdb-count Pacientet` returning 10,187 while `mdb-json Pacientet`
# emits 11,163 valid JSON objects (every line parseable, none
# malformed). The discrepancy is an mdb-count bug, not a memo-field
# inflation. We treat the iteration itself as the single source of
# truth for row counts — the import phases tally as they go.
MDB_JSON_BIN = "mdb-json"


class AbstractReader(Protocol):
    def iter_table(self, table: str) -> Iterator[dict[str, Any]]: ...


class AccessReader:
    """`mdb-json`-backed reader. Constructed via the `open()` classmethod."""

    def __init__(self, path: Path) -> None:
        self._path = path

    @classmethod
    @contextlib.contextmanager
    def open(cls, path: Path) -> Iterator["AccessReader"]:
        """Verify the source file + mdbtools binaries; yield a reader.

        The context manager shape is preserved from the prior pyodbc
        implementation so callers don't need to change. mdb-json is a
        subprocess per-table call, so there is no long-lived
        connection to close on exit.
        """
        if not path.exists():
            raise FileNotFoundError(f"Access source not found: {path}")
        if shutil.which(MDB_JSON_BIN) is None:
            raise RuntimeError(
                f"{MDB_JSON_BIN} not found on PATH. Install mdbtools: "
                "`brew install mdbtools` (macOS) or `apt install mdbtools` (Ubuntu)."
            )
        yield cls(path)

    def iter_table(self, table: str) -> Iterator[dict[str, Any]]:
        """Stream rows from `mdb-json` as dicts.

        One JSON object per line on stdout; we deserialise each line
        and yield it. Memo fields that contain newlines arrive escaped
        as `\\u000d\\u000a` inside JSON strings, so json.loads round-
        trips them to real `\\r\\n` characters in the Python string.

        The subprocess is reaped on iterator exhaustion or generator
        close. A non-zero exit code raises RuntimeError so a partial
        table read is never silently treated as a complete import.
        """
        proc = subprocess.Popen(
            [MDB_JSON_BIN, str(self._path), table],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        try:
            assert proc.stdout is not None  # noqa: S101
            for line in proc.stdout:
                stripped = line.strip()
                if not stripped:
                    continue
                yield json.loads(stripped)
        finally:
            if proc.stdout is not None:
                proc.stdout.close()
            proc.wait()
            if proc.returncode not in (0, None):
                stderr_tail = ""
                if proc.stderr is not None:
                    stderr_tail = proc.stderr.read().strip()[-200:]
                raise RuntimeError(
                    f"{MDB_JSON_BIN} exited {proc.returncode} reading {table}. "
                    f"stderr tail: {stderr_tail!r}"
                )
            if proc.stderr is not None:
                proc.stderr.close()
