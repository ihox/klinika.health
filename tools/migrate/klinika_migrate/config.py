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

import yaml


# Matches `${VAR}` placeholders inside string config values.
_ENV_REF = re.compile(r"\$\{([A-Z_][A-Z0-9_]*)\}")


@dataclass(frozen=True)
class SourceConfig:
    path: Path
    odbc_driver: str


@dataclass(frozen=True)
class TargetConfig:
    dsn: str
    clinic_subdomain: str


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

    return Config(
        source=SourceConfig(
            path=source_path,
            odbc_driver=str(src.get("odbc_driver", "MDBTools")),
        ),
        target=TargetConfig(
            dsn=str(tgt.get("dsn") or ""),
            clinic_subdomain=str(tgt.get("clinic_subdomain") or ""),
        ),
        options=OptionsConfig(
            dry_run=bool(opts.get("dry_run", True)),
            log_dir=log_dir,
        ),
    )
