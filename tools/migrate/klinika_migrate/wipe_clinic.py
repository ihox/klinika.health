"""Pre-migration cleanup — wipe all clinical data for one clinic.

This is the inverse of `patients` / `visits` import. Before re-running
the Access migration on a clinic that already has seed/test data, we
hard-delete every row of patient + visit-derived data and start from
zero. The clinic row itself, its users, audit history, and any other
tenant's data are left alone.

Scope (deleted):
  - patients
  - visits
  - visit_diagnoses, visit_amendments, visit_dicom_links
  - vertetime
  - dicom_studies
  - doctor_diagnosis_usage, prescription_lines

Preserved (never touched):
  - clinics row + its JSONB settings (payment_codes, walkin_duration, etc.)
  - users (Dr. Taulant, Albina, ...)
  - audit_log (append-only history)
  - platform_admins + admin sessions/audit
  - auth_* tables (user sessions, MFA codes, trusted devices)
  - rate_limits, icd10_codes
  - Every other clinic's rows

Safety:
  - Single transaction; dry-run mode rolls back at the end, --commit
    commits. Any mid-wipe error rolls the whole thing back.
  - `--commit` must be explicit. The default invocation is dry-run.
  - Refuses to run if the clinic cannot be resolved.

The script is committed to the repo, not single-use — we will need it
again every time a new tenant onboards from a legacy Access file.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .db import Database


@dataclass(frozen=True)
class WipeStep:
    """One row of the wipe plan.

    `count_sql` returns the row count that would be deleted (for dry-run
    summary and pre/post verification). `delete_sql` performs the actual
    delete. Both take `clinic_id` as the single parameter.
    """

    label: str
    count_sql: str
    delete_sql: str


# Order matters. NoAction FKs are deleted child-first so the parent
# delete doesn't violate the constraint. CASCADE FKs (visit_diagnoses,
# visit_amendments → visits) are also deleted explicitly first so the
# dry-run summary shows their counts rather than reporting "cascaded
# away by visits" and to keep the wipe self-documenting.
WIPE_STEPS: tuple[WipeStep, ...] = (
    WipeStep(
        label="visit_diagnoses",
        count_sql=(
            "SELECT COUNT(*) AS c FROM visit_diagnoses "
            "WHERE visit_id IN (SELECT id FROM visits WHERE clinic_id = %s)"
        ),
        delete_sql=(
            "DELETE FROM visit_diagnoses "
            "WHERE visit_id IN (SELECT id FROM visits WHERE clinic_id = %s)"
        ),
    ),
    WipeStep(
        label="visit_amendments",
        count_sql="SELECT COUNT(*) AS c FROM visit_amendments WHERE clinic_id = %s",
        delete_sql="DELETE FROM visit_amendments WHERE clinic_id = %s",
    ),
    WipeStep(
        label="visit_dicom_links",
        count_sql=(
            "SELECT COUNT(*) AS c FROM visit_dicom_links "
            "WHERE visit_id IN (SELECT id FROM visits WHERE clinic_id = %s)"
        ),
        delete_sql=(
            "DELETE FROM visit_dicom_links "
            "WHERE visit_id IN (SELECT id FROM visits WHERE clinic_id = %s)"
        ),
    ),
    WipeStep(
        label="vertetime",
        count_sql="SELECT COUNT(*) AS c FROM vertetime WHERE clinic_id = %s",
        delete_sql="DELETE FROM vertetime WHERE clinic_id = %s",
    ),
    WipeStep(
        label="dicom_studies",
        count_sql="SELECT COUNT(*) AS c FROM dicom_studies WHERE clinic_id = %s",
        delete_sql="DELETE FROM dicom_studies WHERE clinic_id = %s",
    ),
    WipeStep(
        label="doctor_diagnosis_usage",
        count_sql="SELECT COUNT(*) AS c FROM doctor_diagnosis_usage WHERE clinic_id = %s",
        delete_sql="DELETE FROM doctor_diagnosis_usage WHERE clinic_id = %s",
    ),
    WipeStep(
        label="prescription_lines",
        count_sql="SELECT COUNT(*) AS c FROM prescription_lines WHERE clinic_id = %s",
        delete_sql="DELETE FROM prescription_lines WHERE clinic_id = %s",
    ),
    WipeStep(
        label="visits",
        count_sql="SELECT COUNT(*) AS c FROM visits WHERE clinic_id = %s",
        # paired_with_visit_id is SET NULL on its own visits-self-FK.
        # Pre-clear it so the DELETE doesn't have to walk that path
        # while it's busy removing the same set of rows.
        delete_sql=(
            "WITH cleared AS ("
            " UPDATE visits SET paired_with_visit_id = NULL "
            "  WHERE clinic_id = %s AND paired_with_visit_id IS NOT NULL"
            ") "
            "DELETE FROM visits WHERE clinic_id = %s"
        ),
    ),
    WipeStep(
        label="patients",
        count_sql="SELECT COUNT(*) AS c FROM patients WHERE clinic_id = %s",
        delete_sql="DELETE FROM patients WHERE clinic_id = %s",
    ),
)


@dataclass(frozen=True)
class ClinicIdentity:
    id: str
    subdomain: str
    name: str


def resolve_clinic(
    db: Database,
    *,
    clinic_id: str | None,
    subdomain: str | None,
    name: str | None,
) -> ClinicIdentity:
    """Find the target clinic by id, subdomain, or name.

    Exactly one of the three must be provided. Soft-deleted clinics are
    excluded — there is no scenario where we want to wipe a clinic that
    has already been retired.
    """
    provided = [v for v in (clinic_id, subdomain, name) if v]
    if len(provided) != 1:
        raise ValueError(
            "Provide exactly one of --clinic-id, --clinic-subdomain, --clinic-name"
        )

    if clinic_id:
        where, param = "id = %s", clinic_id
    elif subdomain:
        where, param = "subdomain = %s", subdomain
    else:
        where, param = "name = %s", name

    with db._conn.cursor() as cur:  # noqa: SLF001 — internal tool, db is ours
        cur.execute(
            f"SELECT id::text AS id, subdomain, name FROM clinics "
            f"WHERE {where} AND deleted_at IS NULL",
            (param,),
        )
        rows = cur.fetchall()

    if not rows:
        raise RuntimeError(f"Clinic not found ({where.split(' ')[0]} = {param!r})")
    if len(rows) > 1:
        raise RuntimeError(
            f"Multiple clinics matched ({where.split(' ')[0]} = {param!r}); "
            "use --clinic-id to disambiguate"
        )

    row = rows[0]
    return ClinicIdentity(id=row["id"], subdomain=row["subdomain"], name=row["name"])


def wipe_clinic(
    db: Database,
    clinic: ClinicIdentity,
    *,
    dry_run: bool,
    logger: logging.Logger,
) -> list[tuple[str, int]]:
    """Run every step in WIPE_STEPS.

    Returns [(table_label, rows_affected_or_counted), ...] in deletion
    order. The caller prints the summary table.
    """
    results: list[tuple[str, int]] = []

    logger.info(
        "wipe.start",
        extra={
            "clinic_id": clinic.id,
            "clinic_subdomain": clinic.subdomain,
            "clinic_name": clinic.name,
            "dry_run": dry_run,
        },
    )

    for step in WIPE_STEPS:
        with db._conn.cursor() as cur:  # noqa: SLF001
            if dry_run:
                cur.execute(step.count_sql, (clinic.id,))
                row = cur.fetchone()
                affected = int(row["c"]) if row else 0
            else:
                # Pre-count so the summary reflects what was deleted,
                # even after the DELETE has removed the rows.
                cur.execute(step.count_sql, (clinic.id,))
                row = cur.fetchone()
                pre_count = int(row["c"]) if row else 0

                params: tuple[str, ...]
                if step.label == "visits":
                    # The CTE-form visits delete takes clinic_id twice
                    # (once for the UPDATE, once for the DELETE).
                    params = (clinic.id, clinic.id)
                else:
                    params = (clinic.id,)
                cur.execute(step.delete_sql, params)
                affected = cur.rowcount if cur.rowcount >= 0 else pre_count

        results.append((step.label, affected))
        logger.info(
            "wipe.step",
            extra={"table": step.label, "rows": affected, "dry_run": dry_run},
        )

    logger.info(
        "wipe.done",
        extra={
            "clinic_id": clinic.id,
            "dry_run": dry_run,
            "total_rows": sum(n for _, n in results),
        },
    )
    return results


def print_summary(
    clinic: ClinicIdentity,
    results: list[tuple[str, int]],
    *,
    dry_run: bool,
) -> None:
    """Human-readable summary printed after the wipe."""
    header = "Would delete" if dry_run else "Deleted"
    print()
    print(f"Clinic: {clinic.name} ({clinic.subdomain})  id={clinic.id}")
    print(f"Mode:   {'DRY-RUN (rolled back)' if dry_run else 'COMMIT (applied)'}")
    print()
    width = max(len(label) for label, _ in results)
    print(f"  {'Table'.ljust(width)}  {header}")
    print(f"  {'-' * width}  {'-' * len(header)}")
    for label, rows in results:
        print(f"  {label.ljust(width)}  {rows:>{len(header)}}")
    print(f"  {'-' * width}  {'-' * len(header)}")
    print(f"  {'TOTAL'.ljust(width)}  {sum(n for _, n in results):>{len(header)}}")
    print()
    if dry_run:
        print("Dry-run only. Re-run with --commit to apply.")
    else:
        print("Wipe complete. Re-run patients/visits import when ready.")
