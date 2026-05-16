"""Structured logger for the migration tool.

Klinika's API uses Pino (JSON to stdout) per CLAUDE.md §7. Migration
tooling can be a little louder than the API — it's a one-off
operation supervised by an engineer — but the same PHI rule applies:
log identifiers (legacy_id), never names or DOBs.

The console handler emits human-readable lines; an optional file
handler writes JSON to migration-logs/run.log for archiving.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname.lower(),
            "msg": record.getMessage(),
        }
        # `extra={...}` kwargs land on the record as arbitrary
        # attributes; pull anything that isn't a stdlib field.
        skip = {
            "name", "msg", "args", "levelname", "levelno", "pathname", "filename", "module",
            "exc_info", "exc_text", "stack_info", "lineno", "funcName", "created", "msecs",
            "relativeCreated", "thread", "threadName", "processName", "process", "message",
            "taskName",
        }
        for key, value in record.__dict__.items():
            if key not in skip and not key.startswith("_"):
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False, default=str)


def get_logger(log_dir: Path) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("klinika.migrate")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()

    console = logging.StreamHandler()
    console.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    logger.addHandler(console)

    file_handler = logging.FileHandler(log_dir / "run.log", encoding="utf-8")
    file_handler.setFormatter(_JsonFormatter())
    logger.addHandler(file_handler)

    return logger
