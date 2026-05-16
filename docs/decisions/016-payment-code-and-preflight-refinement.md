# ADR 016: Payment-code mapping + Tjera preflight refinement

Date: 2026-05-17
Status: Accepted — refines [ADR-012](./012-vizitat-field-mapping-correction.md)

## Context

Slice 17 STEP 6 visits dry-run produced empirical evidence that overturned three assumptions in [ADR-012](./012-vizitat-field-mapping-correction.md):

1. **Tjera distinct-count.** ADR-012's preflight required `≤ 10` distinct values in `Vizitat.Tjera`. The audited file has **93 distinct values** — preflight aborted. But the top 5 cover **99.72%** of rows: `B (41.10%)`, `A (25.56%)`, `E (22.32%)`, `C (10.01%)`, `NULL (0.72%)`. The long tail is data-entry noise (hospitalisation date ranges like `'29-30.01.2025'`, dashes, lowercase typos). A distinct-count rule treats noise the same as column drift; it isn't the right test.

2. **'E' payment code.** ADR-012 mapped `E → NULL + warning` on the assumption that E was rare and its meaning was unclear. STEP 6 found E is **22.32% of all visits** — 14,184 rows. With that prevalence, E is clearly a real workflow code in Dr. Taulant's practice, not an anomaly to discard.

3. **'D' payment code.** ADR-012's documented alphabet was `{E, A, B, C, D}`. The audited file contains **zero** `D` rows. Empirical alphabet is `{A, B, C, E}` plus `U` (52 rows, single letter, unknown meaning) and the noise tail.

Lowercase typos exist too: `b` (16), `e` (10), `c` (3) — 29 rows where the doctor pressed shift the wrong way. These were going to `payment_code_unknown` under ADR-012 even though their meaning is obvious.

## Decision

### 1. Coverage-based preflight (replaces ADR-012's distinct-count rule)

`Vizitat.Tjera` preflight passes iff the top-10 distinct values cover **≥ 99%** of rows. Constants:

```python
PAYMENT_TOP_N = 10
PAYMENT_TOP_N_MIN_COVERAGE = 0.99
```

Justification: a real payment-code column has a small alphabet that dominates the rows. A free-text or mis-mapped column has no dominant values — its top-10 covers a tiny fraction (each value appears once or twice in 60k rows). The audited file passes (top 5 alone = 99.72%); a column holding memo text would fail loudly.

Test cases in `test_visits.py` cover both directions: long-tail-noise file passes, free-text file aborts.

### 2. 'E' is real data, not noise

`_map_payment_code` migrates `E` as-is into `visits.payment_code`. The `payment_code_e_dropped` warning code is removed. `_KNOWN_PAYMENT_CODES = frozenset({"A", "B", "C", "D", "E"})` — D stays in the alphabet for forward-compat so a future row carrying it migrates without code change.

The schema column is `Char(1)` with no CHECK constraint, so storing `E` is valid SQL. The per-clinic `clinics.payment_codes` JSON config will eventually carry the label for E; that's a UI concern, not a migration concern.

### 3. Case-fold + tighter unknown-value categorisation

`_map_payment_code` now classifies into three branches:

- **Single letter, in `{A,B,C,D,E}` after case-folding** → migrate as that letter. Recovers ~29 lowercase typos.
- **Single letter, outside the alphabet** (e.g. `U` × 52) → NULL + `payment_code_unknown_letter` warning.
- **Anything else** (date ranges, `'-'`, multi-character text — ~80 distinct rows) → NULL + `payment_code_non_code` warning.

The two distinct warning codes let the post-cutover review separate "unknown letter, ask the doctor" from "non-code data, leave as-is or migrate to a notes field".

## Consequences

- The audited file passes preflight and imports cleanly with payment codes faithfully preserved on 99.95% of rows (only ~80 non-code rows + 52 unknown-letter rows go NULL).
- 14,184 visits keep their `E` payment code — recoverable signal that ADR-012 was discarding.
- ~29 lowercase-typo rows that were `payment_code_unknown` are now correctly bucketed into A/B/C/E.
- Future tenants with different payment alphabets will surface as either preflight failure (no dominant values) or `payment_code_unknown_letter` warnings (new letters appear) — both visible in the reconciliation report.
- Adds a UI-side follow-up: Klinika's payment-code rendering needs to know about `E` (and eventually `U` if the doctor clarifies its meaning). Tracked in `backlog.md`.

The drift-zero invariant in `reconciliation.py` is unchanged — `tool_minus_db == 0` and `db_minus_tool == 0` still auto-FAIL.

## Revisit when

- A new tenant's source has a different payment-code alphabet — the `_KNOWN_PAYMENT_CODES` frozenset becomes per-tenant config.
- `U` semantics are clarified by Dr. Taulant. Promote it into the alphabet, drop the warning.
- Distribution-of-warnings analysis post-cutover shows a systematic pattern in `payment_code_non_code` rows that's worth recovering (e.g. all date ranges map to a hospitalisation flag).

## See also

- [ADR-012](./012-vizitat-field-mapping-correction.md) — original Vizitat field mapping. The payment-code mapping and the preflight section are refined here.
- [ADR-014](./014-access-reader-mdb-json.md) — reader change that enabled this STEP-6 discovery.
- [ADR-015](./015-dob-orphan-policy.md) — patient-phase orphan policy + verdict carve-out. Independent of this ADR.
