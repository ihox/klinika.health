"""Unit tests for the pure parsers.

Each function in parsers.py is the chokepoint where one Access column
becomes one Klinika column. They're easy to test (pure functions) and
critical to get right — a single mis-parse compounds across 220k rows.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

import pytest

from klinika_migrate.parsers import (
    clean_text,
    parse_decimal_cm,
    parse_dob,
    parse_int_grams,
    parse_name,
    parse_phone,
    parse_temperature,
    parse_visit_date,
)


# ---------------------------------------------------------------------------
# parse_name — asterisk handling is the headline behaviour
# ---------------------------------------------------------------------------


class TestParseName:
    def test_clean_name_no_asterisks(self) -> None:
        parsed = parse_name("Rita Hoxha")
        assert parsed is not None
        assert parsed.first_name == "Rita"
        assert parsed.last_name == "Hoxha"
        assert parsed.has_asterisks is False
        assert parsed.legacy_display_name == "Rita Hoxha"

    def test_single_asterisk(self) -> None:
        parsed = parse_name("Rita Hoxha*")
        assert parsed is not None
        assert parsed.first_name == "Rita"
        assert parsed.last_name == "Hoxha"
        assert parsed.has_asterisks is True
        # The starred form is what visit-import uses to match Vizitat.x.
        assert parsed.legacy_display_name == "Rita Hoxha*"

    def test_double_asterisk_with_whitespace(self) -> None:
        """The audit found names like 'Jon Gashi **' — verify both stars
        and the surrounding whitespace are stripped from first/last
        but preserved verbatim in legacy_display_name."""
        parsed = parse_name("Jon Gashi **")
        assert parsed is not None
        assert parsed.first_name == "Jon"
        assert parsed.last_name == "Gashi"
        assert parsed.has_asterisks is True
        assert parsed.legacy_display_name == "Jon Gashi **"

    def test_triple_asterisk(self) -> None:
        parsed = parse_name("Person Name***")
        assert parsed is not None
        assert parsed.has_asterisks is True
        assert parsed.last_name == "Name"

    def test_compound_surname(self) -> None:
        """Double-barrel surnames keep all tokens after the first as
        the last name. Splitting on every whitespace would
        mis-separate 'Ana Maria Hoxha' into three fields."""
        parsed = parse_name("Ana Maria Hoxha")
        assert parsed is not None
        assert parsed.first_name == "Ana"
        assert parsed.last_name == "Maria Hoxha"

    def test_outer_whitespace_trimmed(self) -> None:
        parsed = parse_name("   Rita Hoxha   ")
        assert parsed is not None
        assert parsed.first_name == "Rita"
        assert parsed.last_name == "Hoxha"

    def test_internal_whitespace_collapsed(self) -> None:
        parsed = parse_name("Rita   Hoxha")
        assert parsed is not None
        assert parsed.last_name == "Hoxha"

    def test_single_word_returns_empty_last_name(self) -> None:
        """Single-word names are rare junk in the source but valid
        Python output — caller decides whether to treat as orphan."""
        parsed = parse_name("Pacient")
        assert parsed is not None
        assert parsed.first_name == "Pacient"
        assert parsed.last_name == ""

    @pytest.mark.parametrize("raw", [None, "", "   ", "***", "   *  "])
    def test_returns_none_for_empty(self, raw: str | None) -> None:
        assert parse_name(raw) is None


# ---------------------------------------------------------------------------
# parse_dob — DD.MM.YYYY (Pacientet.Datelindja)
# ---------------------------------------------------------------------------


class TestParseDob:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("01.02.2010", date(2010, 2, 1)),
            ("1.2.2010", date(2010, 2, 1)),
            ("01/02/2010", date(2010, 2, 1)),
            ("01-02-2010", date(2010, 2, 1)),
            ("31.12.1999", date(1999, 12, 31)),
        ],
    )
    def test_known_formats(self, raw: str, expected: date) -> None:
        assert parse_dob(raw) == expected

    @pytest.mark.parametrize("raw", [None, "", "not a date", "32.13.2010", "abcd"])
    def test_unparseable_returns_none(self, raw: str | None) -> None:
        assert parse_dob(raw) is None


# ---------------------------------------------------------------------------
# parse_visit_date — MM/DD/YY (Vizitat.Data, ODBC may pass datetime)
# ---------------------------------------------------------------------------


class TestParseVisitDate:
    def test_us_short_year(self) -> None:
        assert parse_visit_date("03/14/22") == date(2022, 3, 14)

    def test_iso_string(self) -> None:
        assert parse_visit_date("2022-03-14") == date(2022, 3, 14)

    def test_iso_string_with_time(self) -> None:
        assert parse_visit_date("2022-03-14 10:00:00") == date(2022, 3, 14)

    def test_datetime_passthrough_drops_time(self) -> None:
        """ODBC typically returns Access DateTime columns as
        datetime.datetime — visits.visit_date is a Date column, so
        the parser drops the time-of-day."""
        assert parse_visit_date(datetime(2022, 3, 14, 10, 30)) == date(2022, 3, 14)

    def test_date_passthrough(self) -> None:
        d = date(2022, 3, 14)
        assert parse_visit_date(d) is d

    @pytest.mark.parametrize("raw", [None, "", "nonsense"])
    def test_unparseable_returns_none(self, raw: str | None) -> None:
        assert parse_visit_date(raw) is None


# ---------------------------------------------------------------------------
# parse_int_grams — birth weight + current weight
# ---------------------------------------------------------------------------


class TestParseIntGrams:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            (3090, 3090),
            ("3090", 3090),
            ("3.090 kg", 3090),  # EU thousands separator OR kg → grams
            ("3,5 kg", 3500),    # EU decimal comma
            ("3500 g", 3500),
            ("12.5 kg", 12500),  # adolescent weight
        ],
    )
    def test_known_inputs(self, raw: object, expected: int) -> None:
        assert parse_int_grams(raw) == expected  # type: ignore[arg-type]

    @pytest.mark.parametrize("raw", [0, "0", None, "", "   ", "n/a", "?"])
    def test_zero_and_empty_return_none(self, raw: object) -> None:
        assert parse_int_grams(raw) is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# parse_decimal_cm — length / head-circumference fields
# ---------------------------------------------------------------------------


class TestParseDecimalCm:
    def test_dot_decimal(self) -> None:
        assert parse_decimal_cm("52.5") == Decimal("52.50")

    def test_comma_decimal_with_unit(self) -> None:
        assert parse_decimal_cm("52,5 cm") == Decimal("52.50")

    def test_integer(self) -> None:
        assert parse_decimal_cm("50") == Decimal("50.00")

    def test_quantizes_to_two_places(self) -> None:
        assert parse_decimal_cm("52.567") == Decimal("52.57")

    def test_zero_returns_none(self) -> None:
        assert parse_decimal_cm("0") is None

    def test_huge_returns_none(self) -> None:
        """5,2 Decimal(5,2) tops out at 999.99 — reject anything beyond
        rather than risk a NUMERIC overflow on insert."""
        assert parse_decimal_cm("1000") is None

    @pytest.mark.parametrize("raw", [None, "", "n/a"])
    def test_empty_returns_none(self, raw: str | None) -> None:
        assert parse_decimal_cm(raw) is None


# ---------------------------------------------------------------------------
# parse_temperature — narrower physical range than the cm parser
# ---------------------------------------------------------------------------


class TestParseTemperature:
    def test_normal_body_temp(self) -> None:
        assert parse_temperature("37.2") == Decimal("37.20")

    def test_below_range_returns_none(self) -> None:
        assert parse_temperature("20") is None

    def test_above_range_returns_none(self) -> None:
        assert parse_temperature("120") is None


# ---------------------------------------------------------------------------
# parse_phone — best-effort Kosovo number normalisation
# ---------------------------------------------------------------------------


class TestParsePhone:
    def test_long_integer_input(self) -> None:
        assert parse_phone(44123456) == "+383 44123456"

    def test_domestic_with_leading_zero(self) -> None:
        assert parse_phone("044123456") == "+383 44123456"

    def test_already_canonical_idempotent(self) -> None:
        """The parser should not double-prefix '+383 ' onto a number
        that already has it (catches a regression from an earlier
        smoke test)."""
        assert parse_phone("+383 44123456") == "+383 44123456"

    def test_double_zero_prefix(self) -> None:
        assert parse_phone("0038344123456") == "+383 44123456"

    @pytest.mark.parametrize("raw", [None, 0, "", "0", "00"])
    def test_empty_returns_none(self, raw: object) -> None:
        assert parse_phone(raw) is None  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# clean_text — trivial but heavily reused
# ---------------------------------------------------------------------------


class TestCleanText:
    def test_trims(self) -> None:
        assert clean_text("  hello  ") == "hello"

    def test_empty_returns_none(self) -> None:
        assert clean_text("   ") is None

    def test_none_returns_none(self) -> None:
        assert clean_text(None) is None
