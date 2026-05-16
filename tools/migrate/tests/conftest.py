"""Shared pytest fixtures.

The migration tool's external boundaries (Access via pyodbc, Postgres
via psycopg) are stubbed here so the test suite runs offline and
without driver setup.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from klinika_migrate.access import AbstractReader
from klinika_migrate.reports import JsonlWriter


class StubReader(AbstractReader):
    """In-memory AccessReader for tests.

    Holds a {table_name: [rows]} dict and exposes the same
    `iter_table` surface the real `AccessReader` does.
    """

    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        self._tables = tables

    def iter_table(self, table: str) -> Iterator[dict[str, Any]]:
        for row in self._tables.get(table, []):
            yield row


@pytest.fixture
def stub_reader_factory() -> type[StubReader]:
    return StubReader


@pytest.fixture
def logger() -> logging.Logger:
    log = logging.getLogger("klinika.test")
    log.setLevel(logging.CRITICAL)  # keep test output clean
    return log


@pytest.fixture
def writers(tmp_path: Path) -> dict[str, JsonlWriter]:
    """Open warnings/orphans writers in a temp dir; auto-close on test end."""
    warnings = JsonlWriter(tmp_path / "warnings.jsonl")
    orphans = JsonlWriter(tmp_path / "orphans.jsonl")
    yield {"warnings": warnings, "orphans": orphans, "dir": tmp_path}
    warnings.close()
    orphans.close()
