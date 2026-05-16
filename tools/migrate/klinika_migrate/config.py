"""Config loader for the migration tool.

config.yaml is intentionally small: connection strings, target clinic,
source path. All parsing rules and field mappings live in code (see
parsers.py and patients.py) where they can be unit-tested.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import yaml


# Matches `${VAR}` placeholders inside string config values.
_ENV_REF = re.compile(r"\$\{([A-Z_][A-Z0-9_]*)\}")

# Query parameters that appear in Prisma-style DATABASE_URLs but that
# psycopg's libpq URI parser rejects with "invalid URI query
# parameter". The same DATABASE_URL gets reused for the migration
# tool (the operator copies it from .env), so strip these out
# silently rather than fail on a hand-off. STEP 6 first hit this with
# `?schema=public`.
_PRISMA_ONLY_DSN_PARAMS = frozenset({
    "schema",
    "connection_limit",
    "pool_timeout",
    "pgbouncer",
    "socket_timeout",
})


def strip_prisma_dsn_params(dsn: str) -> tuple[str, list[str]]:
    """Return (cleaned_dsn, stripped_param_names).

    Pure function — no logging, no side effects — so the CLI can decide
    whether to log the stripped params (useful) or stay silent (in
    tests). Called by `load_config` before the DSN reaches psycopg.
    """
    if not dsn or "?" not in dsn:
        return dsn, []
    parts = urlsplit(dsn)
    if not parts.query:
        return dsn, []
    kept: list[tuple[str, str]] = []
    stripped: list[str] = []
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key in _PRISMA_ONLY_DSN_PARAMS:
            stripped.append(key)
        else:
            kept.append((key, value))
    if not stripped:
        return dsn, []
    new_query = urlencode(kept)
    cleaned = urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))
    return cleaned, stripped


@dataclass(frozen=True)
class SourceConfig:
    path: Path


@dataclass(frozen=True)
class TargetConfig:
    dsn: str
    clinic_subdomain: str
    # Email of the user to credit as created_by / updated_by on all
    # migrated visits. Optional — if omitted, the tool picks the
    # oldest active doctor in the target clinic (Dr. Taulant for
    # DonetaMED, by construction).
    migration_user_email: str | None


@dataclass(frozen=True)
class OptionsConfig:
    dry_run: bool
    log_dir: Path


@dataclass(frozen=True)
class Config:
    source: SourceConfig
    target: TargetConfig
    options: OptionsConfig


def _expand_env(value: Any) -> Any:
    """Replace ${VAR} placeholders with environment values, recursively."""
    if isinstance(value, str):

        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            env = os.environ.get(name)
            if env is None:
                raise ValueError(f"Config references ${{{name}}} but it is not set in the environment")
            return env

        return _ENV_REF.sub(replace, value)
    if isinstance(value, dict):
        return {k: _expand_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_expand_env(v) for v in value]
    return value


def load_config(path: Path) -> Config:
    """Load and validate config.yaml."""
    if not path.exists():
        raise FileNotFoundError(f"Config not found: {path}")
    raw: dict[str, Any] = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    raw = _expand_env(raw)

    src = raw.get("source") or {}
    tgt = raw.get("target") or {}
    opts = raw.get("options") or {}

    source_path = Path(str(src.get("path", ""))).expanduser()
    log_dir = Path(str(opts.get("log_dir", "./migration-logs"))).expanduser()

    dsn, _stripped = strip_prisma_dsn_params(str(tgt.get("dsn") or ""))

    return Config(
        source=SourceConfig(
            path=source_path,
        ),
        target=TargetConfig(
            dsn=dsn,
            clinic_subdomain=str(tgt.get("clinic_subdomain") or ""),
            migration_user_email=(str(tgt["migration_user_email"]) if tgt.get("migration_user_email") else None),
        ),
        options=OptionsConfig(
            dry_run=bool(opts.get("dry_run", True)),
            log_dir=log_dir,
        ),
    )
