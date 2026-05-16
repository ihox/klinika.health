"""Tests for config-loading edge cases.

The Prisma-DSN-stripping path is the only non-trivial logic in
config.py — the rest is plumbing covered by the import-phase tests.
STEP 6 hit this in production when the operator copied DATABASE_URL
straight from .env (which uses Prisma's `?schema=public` parameter)
into config.yaml; psycopg rejected the URI. Tested here so we never
ship that regression.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from klinika_migrate.config import load_config, strip_prisma_dsn_params


class TestStripPrismaDsnParams:
    def test_schema_param_removed(self) -> None:
        dsn = "postgresql://user:pw@host:5432/db?schema=public"
        cleaned, stripped = strip_prisma_dsn_params(dsn)
        assert cleaned == "postgresql://user:pw@host:5432/db"
        assert stripped == ["schema"]

    def test_keeps_non_prisma_params(self) -> None:
        """Standard libpq params like `sslmode` must survive — only
        the Prisma-specific allowlist is stripped."""
        dsn = "postgresql://user:pw@host:5432/db?sslmode=require&schema=public"
        cleaned, stripped = strip_prisma_dsn_params(dsn)
        assert "sslmode=require" in cleaned
        assert "schema" in stripped
        assert "schema=public" not in cleaned

    def test_no_query_string_passthrough(self) -> None:
        dsn = "postgresql://user:pw@host:5432/db"
        cleaned, stripped = strip_prisma_dsn_params(dsn)
        assert cleaned == dsn
        assert stripped == []

    def test_empty_dsn_passthrough(self) -> None:
        cleaned, stripped = strip_prisma_dsn_params("")
        assert cleaned == ""
        assert stripped == []

    def test_multiple_prisma_params_stripped(self) -> None:
        dsn = (
            "postgresql://user:pw@host:5432/db"
            "?schema=public&connection_limit=5&pgbouncer=true"
        )
        cleaned, stripped = strip_prisma_dsn_params(dsn)
        assert "schema" not in cleaned
        assert "connection_limit" not in cleaned
        assert "pgbouncer" not in cleaned
        assert set(stripped) == {"schema", "connection_limit", "pgbouncer"}


class TestLoadConfigDsnCleaning:
    def test_load_config_strips_schema_query_param(self, tmp_path: Path) -> None:
        cfg_path = tmp_path / "config.yaml"
        cfg_path.write_text(
            "source:\n"
            "  path: /tmp/x.accdb\n"
            "target:\n"
            "  dsn: postgresql://klinika:klinika@localhost:5432/klinika?schema=public\n"
            "  clinic_subdomain: donetamed\n"
            "options:\n"
            "  dry_run: true\n"
            "  log_dir: ./migration-logs\n",
            encoding="utf-8",
        )
        cfg = load_config(cfg_path)
        assert cfg.target.dsn == "postgresql://klinika:klinika@localhost:5432/klinika"
        assert "?schema" not in cfg.target.dsn

    def test_load_config_keeps_clean_dsn_intact(self, tmp_path: Path) -> None:
        cfg_path = tmp_path / "config.yaml"
        cfg_path.write_text(
            "source:\n"
            "  path: /tmp/x.accdb\n"
            "target:\n"
            "  dsn: postgresql://klinika:klinika@localhost:5432/klinika\n"
            "  clinic_subdomain: donetamed\n"
            "options:\n"
            "  dry_run: true\n",
            encoding="utf-8",
        )
        cfg = load_config(cfg_path)
        assert cfg.target.dsn == "postgresql://klinika:klinika@localhost:5432/klinika"
