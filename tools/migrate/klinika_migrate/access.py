"""Access (.accdb) reader for the migration tool.

Wraps pyodbc against the mdbtools ODBC driver. Streams rows one-at-a-
time so memory stays flat over the 220k-row Vizitat table.

The mdb-export CLI was rejected (ADR-010 refinement, 2026-05-16): memo
fields containing newlines or commas break its CSV escaping. ODBC
returns memos as Python strings with embedded newlines preserved.

Tests stub this class out via the AbstractReader protocol so they
don't need an actual .accdb file (which carries PHI and is not
committed).
"""

from __future__ import annotations

import contextlib
from pathlib import Path
from typing import Any, Iterator, Protocol


class AbstractReader(Protocol):
    def count_rows(self, table: str) -> int: ...
    def iter_table(self, table: str) -> Iterator[dict[str, Any]]: ...


class AccessReader:
    """pyodbc-backed reader. Constructed via the `open()` classmethod."""

    def __init__(self, conn: Any) -> None:
        self._conn = conn

    @classmethod
    @contextlib.contextmanager
    def open(cls, path: Path, odbc_driver: str) -> Iterator["AccessReader"]:
        """Open a connection to an .accdb file via the mdbtools ODBC driver."""
        # Imported here so unit tests that stub AbstractReader don't
        # need pyodbc installed (and don't need the ODBC driver
        # configured) just to import this module.
        import pyodbc  # noqa: WPS433

        if not path.exists():
            raise FileNotFoundError(f"Access source not found: {path}")
        conn_str = f"DRIVER={{{odbc_driver}}};DBQ={path.resolve()};"
        conn = pyodbc.connect(conn_str, autocommit=True)
        try:
            yield cls(conn)
        finally:
            conn.close()

    def count_rows(self, table: str) -> int:
        cursor = self._conn.cursor()
        # mdbtools accepts bracketed identifiers for table names with
        # spaces; Pacientet/Vizitat are simple identifiers but we keep
        # the convention for safety.
        cursor.execute(f"SELECT COUNT(*) FROM [{table}]")
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def iter_table(self, table: str) -> Iterator[dict[str, Any]]:
        """Yield rows as {column_name: value} dicts.

        pyodbc returns rows as Row objects; we materialise to dict
        because callers want to access fields by Access column name
        (including the awkward "Emri dhe mbiemri" and "x").
        """
        cursor = self._conn.cursor()
        cursor.execute(f"SELECT * FROM [{table}]")
        columns = [col[0] for col in cursor.description or []]
        while True:
            row = cursor.fetchone()
            if row is None:
                return
            yield {col: row[i] for i, col in enumerate(columns)}
