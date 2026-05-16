"""Pure parsing helpers for the Access -> Klinika migration.

Every function here is side-effect free and returns either a clean
parsed value or None (with a warning code) so the import phases can
log + continue. Unit-tested in tests/test_parsers.py.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Final


# ---------------------------------------------------------------------------
# Name parsing
# ---------------------------------------------------------------------------

# Trailing asterisks (with optional whitespace between them). Used by the
# Access source as an ad-hoc uniqueness workaround for duplicate names.
_TRAILING_STARS = re.compile(r"\s*\*+\s*$")
# Collapse runs of internal whitespace ("Jon  Gashi" -> "Jon Gashi").
_WHITESPACE_RUN = re.compile(r"\s+")


@dataclass(frozen=True)
class ParsedName:
    first_name: str
    last_name: str
    has_asterisks: bool
    # The original source string, trimmed of outer whitespace but with
    # asterisks intact — this is what gets stored in
    # patients.legacy_display_name and what the visit-import phase uses
    # to resolve `Vizitat.x` back to a patient.
    legacy_display_name: str


def parse_name(raw: str | None) -> ParsedName | None:
    """Split an Access "Emri dhe mbiemri" string into first/last name.

    - Strips trailing asterisks and surrounding whitespace.
    - Splits on the first whitespace run: first token is first name,
      remainder is last name (so "Ana Maria Hoxha" -> first="Ana",
      last="Maria Hoxha", preserving compound surnames intact).
    - Returns None if the result is unusable (empty or single-word).
      Single-word names are flagged so the caller can decide whether
      to import with an empty last_name; in practice every pediatric
      patient in the source has at least two tokens.
    """
    if raw is None:
        return None
    legacy = raw.strip()
    if not legacy:
        return None

    has_stars = bool(_TRAILING_STARS.search(legacy))
    stripped = _TRAILING_STARS.sub("", legacy).strip()
    stripped = _WHITESPACE_RUN.sub(" ", stripped)
    if not stripped:
        return None

    parts = stripped.split(" ", 1)
    if len(parts) == 1:
        # Single-word "name" — likely junk. Caller should treat as a
        # parse warning, not a clean import.
        return ParsedName(
            first_name=parts[0],
            last_name="",
            has_asterisks=has_stars,
            legacy_display_name=legacy,
        )

    return ParsedName(
        first_name=parts[0],
        last_name=parts[1],
        has_asterisks=has_stars,
        legacy_display_name=legacy,
    )


# ---------------------------------------------------------------------------
# Date parsing
# ---------------------------------------------------------------------------

# Pacientet.Datelindja is stored as Text in DD.MM.YYYY. The source has
# stray variants: missing leading zeros, slashes instead of dots, and
# the occasional MM/DD/YYYY mix-up. We accept the common variants and
# reject anything we can't unambiguously map.
_DOB_PATTERNS: Final[tuple[str, ...]] = (
    "%d.%m.%Y",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%d.%m.%y",
)


def parse_dob(raw: str | None) -> date | None:
    """Parse Pacientet.Datelindja (DD.MM.YYYY)."""
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    for pattern in _DOB_PATTERNS:
        try:
            return datetime.strptime(s, pattern).date()
        except ValueError:
            continue
    return None


# Vizitat.Data is DateTime in MM/DD/YY at the source — Access exposes it
# already as a datetime via ODBC, but the JSONL fallback path may pass
# it as a string. Accept both shapes.
_VISIT_DATE_PATTERNS: Final[tuple[str, ...]] = (
    "%m/%d/%y %H:%M:%S",
    "%m/%d/%y",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)


def parse_visit_date(raw: str | datetime | date | None) -> date | None:
    """Parse Vizitat.Data into a date (we drop the time-of-day)."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw.date()
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()
    if not s:
        return None
    for pattern in _VISIT_DATE_PATTERNS:
        try:
            return datetime.strptime(s, pattern).date()
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Measurement parsing
# ---------------------------------------------------------------------------

# Pulls the first numeric token out of a free-text measurement. Handles
# Albanian decimal commas, embedded units ("3.090 kg", "52 cm"), and
# space-as-thousands ("3 090").
_NUMERIC_TOKEN = re.compile(r"-?\d+(?:[.,]\d+)?")


def _to_decimal(token: str) -> Decimal | None:
    # Normalise Albanian/EU decimal commas to dots.
    s = token.replace(",", ".")
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def parse_int_grams(raw: str | int | None) -> int | None:
    """Birth weight (Pacientet.PL) or current weight (Vizitat.PT).

    Pacientet.PL is stored as Access Integer — 0 means "not recorded"
    (ADR-010). Vizitat.PT is stored as Text and may carry units like
    "3.5 kg" or "3500" or "3,5 kg" (EU decimal comma). Heuristic: if
    the parsed magnitude is < 100, the caller meant kilograms and we
    convert to grams (no human-recorded child weighs less than 100g).
    """
    if raw is None:
        return None
    if isinstance(raw, int):
        return None if raw == 0 else raw
    s = str(raw).strip()
    if not s:
        return None
    match = _NUMERIC_TOKEN.search(s)
    if not match:
        return None
    dec = _to_decimal(match.group(0))
    if dec is None or dec <= 0:
        return None
    grams = int(dec * 1000) if dec < 100 else int(dec)
    return grams or None


def parse_decimal_cm(raw: str | int | float | Decimal | None) -> Decimal | None:
    """Length / head-circumference fields (Pacientet.GJL, .PK, Vizitat.GJT/.PK).

    Stored as free text in the source; we extract the first numeric
    token. NUMERIC(5,2) in Klinika so we round to 2 decimal places and
    reject anything wider than 999.99.
    """
    if raw is None:
        return None
    if isinstance(raw, (int, float, Decimal)):
        dec = Decimal(str(raw))
    else:
        s = str(raw).strip()
        if not s:
            return None
        match = _NUMERIC_TOKEN.search(s)
        if not match:
            return None
        dec = _to_decimal(match.group(0))
        if dec is None:
            return None
    if dec <= 0 or dec >= Decimal("1000"):
        return None
    return dec.quantize(Decimal("0.01"))


def parse_temperature(raw: str | int | float | Decimal | None) -> Decimal | None:
    """Body temperature in Celsius (Vizitat.Temp).

    Plausible range 30..45. Anything outside that is almost certainly
    garbage data and we drop it with no warning (the doctor wouldn't
    have recorded 12°C anyway).
    """
    dec = parse_decimal_cm(raw)
    if dec is None:
        return None
    if dec < Decimal("30") or dec > Decimal("45"):
        return None
    return dec


# ---------------------------------------------------------------------------
# Phone parsing
# ---------------------------------------------------------------------------


def parse_phone(raw: int | str | None) -> str | None:
    """Kosovo phone normaliser for Pacientet.Telefoni.

    The Access source stores phones as Long Integer, so leading zeros
    and the +383 country code are lost. ~0.04% of patients have any
    phone at all (ADR-010), so this is best-effort: we strip any
    leading zeros (a domestic "044…" was stored as 44…) and prefix
    the canonical international "+383 " so the field is at least
    well-formed even if the doctor needs to spot-check.
    """
    if raw is None:
        return None
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    digits = digits.lstrip("0")
    if not digits:
        return None
    # Some operators may already have typed "+383 …" or "00383 …". Strip
    # the country-code prefix so we don't end up with "+383 383…".
    if digits.startswith("383"):
        digits = digits[3:]
    if not digits:
        return None
    return f"+383 {digits}"


# ---------------------------------------------------------------------------
# Text normalisation
# ---------------------------------------------------------------------------


def clean_text(raw: str | None) -> str | None:
    """Trim and collapse memo fields. Returns None for empty strings."""
    if raw is None:
        return None
    s = raw.strip()
    return s or None
