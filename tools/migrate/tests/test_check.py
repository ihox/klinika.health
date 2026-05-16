"""Tests for the `migrate.py check` self-test suite.

The DB-touching checks are exercised end-to-end by the live STEP 6
runs and the regular import-phase tests; here we focus on the
aggregation, formatting, and per-check error-handling logic which is
the part most likely to silently regress.
"""

from __future__ import annotations

import pytest

from klinika_migrate.check import (
    CheckResult,
    CheckSuite,
    _run,
    format_suite,
)


class TestCheckSuite:
    def test_empty_suite_is_all_ok(self) -> None:
        assert CheckSuite().all_ok is True

    def test_one_failure_flips_all_ok(self) -> None:
        suite = CheckSuite()
        suite.add("ok thing", ok=True)
        suite.add("bad thing", ok=False, detail="boom")
        assert suite.all_ok is False

    def test_all_passing(self) -> None:
        suite = CheckSuite()
        suite.add("a", ok=True)
        suite.add("b", ok=True, detail="passed cleanly")
        assert suite.all_ok is True


class TestRunWrapper:
    def test_exception_becomes_clean_failure(self) -> None:
        """A check that raises should not crash the whole suite — the
        operator should still see every other check's status."""
        suite = CheckSuite()

        def bad() -> tuple[bool, str]:
            raise RuntimeError("kaboom")

        result = _run(bad, "exploding check", suite)
        assert result is False
        assert len(suite.results) == 1
        assert suite.results[0].ok is False
        assert "RuntimeError" in suite.results[0].detail
        assert "kaboom" in suite.results[0].detail

    def test_normal_pass_recorded(self) -> None:
        suite = CheckSuite()
        ok = _run(lambda: (True, "all good"), "happy check", suite)
        assert ok is True
        assert suite.results[0] == CheckResult(name="happy check", ok=True, detail="all good")


class TestFormatSuite:
    def test_pass_summary(self) -> None:
        suite = CheckSuite()
        suite.add("mdbtools binary", ok=True, detail="/opt/homebrew/bin/mdb-json")
        out = format_suite(suite)
        assert "[  OK]" in out
        assert "mdbtools binary" in out
        assert "ALL PASSED" in out

    def test_fail_summary_mentions_actionable_next_step(self) -> None:
        """The format string must point the operator at the next move
        when something failed — otherwise a red 'FAIL' just blocks
        them with no hint."""
        suite = CheckSuite()
        suite.add("postgres connect", ok=False, detail="connection refused")
        out = format_suite(suite)
        assert "[FAIL]" in out
        assert "FAILURES DETECTED" in out
        # The hint should be present and reference --commit explicitly
        # since that's the next thing the operator is trying to run.
        assert "--commit" in out
