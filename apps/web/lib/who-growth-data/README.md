# WHO Child Growth Standards — reference data

Static fixtures of the WHO Child Growth Standards 5-percentile reference
curves used by the growth-chart UI in [`../growth-chart/`](../growth-chart/).

## Source

WHO Multicentre Growth Reference Study (MGRS), 2006 release —
published in expanded percentile tables on
<https://www.who.int/tools/child-growth-standards/standards>:

- `wfa_boys_p_exp.txt`, `wfa_girls_p_exp.txt` — weight-for-age
- `lhfa_boys_p_exp.txt`, `lhfa_girls_p_exp.txt` — length/height-for-age
- `hcfa_boys_p_exp.txt`, `hcfa_girls_p_exp.txt` — head-circumference-for-age

The CSVs publish more percentile columns (P01, P1, P3, P5, P10, P15,
P25, P50, P75, P85, P90, P95, P97, P99, P999). Klinika tracks only the
clinically conventional 5-curve subset — P3, P15, P50, P85, P97. These
are the curves the printed growth charts in Kosovo pediatric practice
use, so the UI matches what doctors are already familiar with.

## Scope

- Ages 0–24 months (monthly granularity, 25 points per series).
- Length-for-age is the supine length measurement used through 24
  months; the standing-height curves take over for older children.
  Klinika hides the WHO panel past 24 months, so the supine curve is
  the only one we ship.

## Licensing

WHO Child Growth Standards are publicly distributed for clinical and
research use — no licensing fee, no attribution beyond a sensible
"WHO Child Growth Standards" reference in the UI. The
[`who-growth-data.ts`](./who-growth-data.ts) module is a verbatim
transcription of the WHO published values rounded to one decimal
(weight/HC) or 0.5 cm (length).

## Updating

If WHO releases revised tables, replace the values in
`who-growth-data.ts` from the CSVs directly — no transformation
needed — and bump the comment block at the top.
