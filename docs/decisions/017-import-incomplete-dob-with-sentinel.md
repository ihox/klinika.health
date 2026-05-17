# ADR 017: Import incomplete-DOB patients with UNKNOWN_DOB_SENTINEL

Date: 2026-05-17
Status: Accepted — supersedes the DOB-orphan rule in [ADR-015](./015-dob-orphan-policy.md)

## Context

ADR-015 (2026-05-17 earlier today) chose to orphan any patient whose Datelindja couldn't be parsed cleanly: 558 patients across three reason codes (`year_only_dob` × 415, `dob_missing` × 58, `dob_unparseable` × 85). The rationale was clinical safety — a pediatric chart with an approximate DOB risks bad decisions on growth charts, dosing, and vaccinations.

Slice 17.5 / 17.6 surfaced a load-bearing piece of context I missed when ADR-015 was written: **Klinika already has a documented "incomplete patient" convention** that the UI understands.

- [apps/api/src/modules/patients/patients.service.ts:579](../../apps/api/src/modules/patients/patients.service.ts) exports `UNKNOWN_DOB_SENTINEL = new Date('1900-01-01T00:00:00Z')`.
- The receptionist quick-add path writes this sentinel when only the patient's name is captured ([patients.dto.ts:340](../../apps/api/src/modules/patients/patients.dto.ts)).
- The `isPatientComplete` predicate ([apps/web/lib/patient.ts:30](../../apps/web/lib/patient.ts), mirrored server-side at [patients.dto.ts:327](../../apps/api/src/modules/patients/patients.dto.ts)) treats `1900-01-01` and empty `last_name` as "patient needs completion".
- The doctor's master-data form gates clinical actions until the predicate flips, surfacing the "PA PLOTËSUAR" chip and "DL pa caktuar" on the chart.

Under ADR-015 those 558 patients are absent from the DB entirely — they don't appear in search, their starred-name visits cascade-orphan (1,027 of them), and Dr. Taulant has to recreate each one by hand from a JSONL file outside the UI. Under the established convention they belong in the DB with the sentinel marker and ride the same completion queue every other incomplete patient already does.

## Decision

Import patients with unparseable DOB. Skip the orphan path.

1. **DOB fallback to `UNKNOWN_DOB_SENTINEL = 1900-01-01`** for the three previously-orphan-bound paths. The reason codes `year_only_dob`, `dob_missing`, `dob_unparseable` become *warnings*, not orphan reasons.
2. **Preserve the verbatim source string in `patients.legacy_dob_raw`** (new TEXT column). The sentinel collapses the original signal; without this column the post-cutover completion queue can't be triaged by raw shape ("year-only kids first, typos last").
3. **Single-token names import with `last_name = ""`** — matches the receptionist quick-add convention already coded into `isPatientComplete`. Previously orphaned as `name_unparseable`.
4. **`name_unparseable` stays an orphan reason** only for truly empty / unidentifiable names. The patient has no identifier in that case, so the row can't be in the DB.
5. **The Vendi↔Datelindja swap detection is unchanged.** Three rows still recover a real DOB this way.
6. **Reconciliation verdict carve-out (ADR-015) becomes mostly dormant.** The `_EXPECTED_ORPHAN_REASONS = {year_only_dob, dob_missing}` set stays in the code as defense in depth — if a future tenant opts out of the sentinel policy and reverts to orphaning, the verdict won't auto-FAIL on it. With the sentinel policy active, those reasons simply don't appear in `orphans_by_reason` so the carve-out never fires.

## Consequences

For the DonetaMED cutover specifically (slice 17.6):
- 558 patients move from "missing from DB" to "imported, flagged for completion."
- The 1,027 cascade-orphaned visits from those patients clear on the visit-phase idempotent re-run.
- Post-migration: 11,163 patients in the DB (= mdb-json source row count). 558 surface in the UI with the existing "PA PLOTËSUAR" chip.
- Dr. Taulant's completion queue is now triagable by `legacy_dob_raw` shape: ~415 rows showing "2018"-style year strings (parents knew the year), 58 with NULL (truly missing), 85 with typos worth a closer look.

Trade-off accepted: the clinical-safety concern that drove ADR-015 doesn't go away — it's now *mitigated* by the UI's incomplete-patient marker rather than enforced by absence from the DB. A doctor who ignores the warning chip and acts on `1900-01-01` as a real DOB is still in trouble. The mitigation is: the same UI affordance protects every other incomplete patient (receptionist quick-adds, etc.); the migration cohort joins that population rather than living outside it.

`legacy_dob_raw` is NULL for any patient whose DOB parsed cleanly (the bulk of the cohort) and for any patient created post-migration through the UI. No CHECK constraint — the application-side contract is "preserve verbatim or NULL."

## Revisit when

- A new tenant's source has DOB-quality patterns we can't represent in the same convention.
- The `isPatientComplete` predicate evolves and changes what "incomplete" means in the UI.
- A clinical-safety incident traces back to a sentinel-DOB patient — would force the orphan policy back.

## See also

- [ADR-015](./015-dob-orphan-policy.md) — the DOB-orphan rule this ADR supersedes. The Vendi↔Datelindja swap section and the reconciliation carve-out are still in effect; only the "orphan vs. import" decision changes.
- [ADR-016](./016-payment-code-and-preflight-refinement.md) — payment-code mapping. Independent of this ADR.
- [apps/api/src/modules/patients/patients.service.ts](../../apps/api/src/modules/patients/patients.service.ts) — `UNKNOWN_DOB_SENTINEL` and `isPatientComplete` definitions.
