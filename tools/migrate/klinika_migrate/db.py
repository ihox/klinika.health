"""Postgres helpers for the migration tool.

The tool connects via DATABASE_URL as a role that has been GRANTed
`platform_admin_role` (BYPASSRLS). We issue `SET ROLE
platform_admin_role` at session start — RLS is then out of the
picture and inserts can touch any clinic row.

We hit Prisma's tables directly via raw SQL (psycopg). Going through
the NestJS service layer would fire 11k+15k audit rows and the same
number of SSE calendar events for what is, semantically, a single
"clinic seeded from legacy data" event — see CLAUDE.md §5.3 and the
audit decorator behaviour in apps/api/src/modules/visits/visits.service.ts.
"""

from __future__ import annotations

import contextlib
import json
from typing import Any, Iterator

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row

from .models import PatientUpsertInput, VisitUpsertInput

__all__ = ["Database", "PatientUpsertInput", "VisitUpsertInput"]


class Database:
    """psycopg wrapper. Use via `Database.open()` context manager."""

    def __init__(self, conn: Connection) -> None:
        self._conn = conn

    @classmethod
    @contextlib.contextmanager
    def open(cls, dsn: str, *, dry_run: bool) -> Iterator["Database"]:
        # autocommit=False so the upsert phase wraps in an explicit
        # transaction. Dry-runs also open a connection so we can still
        # resolve the clinic_id and inspect the schema, but no writes
        # happen in that mode.
        with psycopg.connect(dsn, autocommit=False, row_factory=dict_row) as conn:
            with conn.cursor() as cursor:
                # Acquire the BYPASSRLS role. This is a no-op if the
                # connection already has it directly, and fails fast
                # if the connection role wasn't granted it.
                try:
                    cursor.execute("SET ROLE platform_admin_role")
                except psycopg.Error as err:
                    raise RuntimeError(
                        "Could not SET ROLE platform_admin_role. Two known causes:\n"
                        "  1. The role exists but has no table privileges. Run "
                        "`make db-migrate` from the repo root to re-apply "
                        "apps/api/prisma/sql/001_rls_indexes_triggers.sql (it's "
                        "idempotent — safe to replay).\n"
                        "  2. The connection role wasn't granted platform_admin_role. "
                        "In dev the docker postgres superuser owns everything; in prod, "
                        "GRANT platform_admin_role TO <migration_role>;\n"
                        f"Original psycopg error: {err}"
                    ) from err
            yield cls(conn)
            if dry_run:
                conn.rollback()
            else:
                conn.commit()

    def resolve_clinic_id(self, subdomain: str) -> str:
        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM clinics WHERE subdomain = %s AND deleted_at IS NULL",
                (subdomain,),
            )
            row = cursor.fetchone()
        if not row:
            raise RuntimeError(f"Clinic not found by subdomain: {subdomain}")
        return str(row["id"])

    def resolve_migration_user_id(self, clinic_id: str, email: str | None) -> str:
        """Resolve the user id to credit as created_by/updated_by on migrated visits.

        If `email` is provided, look that user up in the target clinic.
        Otherwise pick the oldest active user with role='doctor' — for
        DonetaMED that is Dr. Taulant, by construction. Fails loudly if
        no doctor exists (the migration target must be seeded first).
        """
        with self._conn.cursor() as cursor:
            if email:
                cursor.execute(
                    """
                    SELECT id FROM users
                    WHERE clinic_id = %s AND email = %s AND deleted_at IS NULL AND is_active
                    """,
                    (clinic_id, email),
                )
            else:
                cursor.execute(
                    """
                    SELECT id FROM users
                    WHERE clinic_id = %s
                      AND 'doctor' = ANY(roles)
                      AND deleted_at IS NULL
                      AND is_active
                    ORDER BY created_at ASC
                    LIMIT 1
                    """,
                    (clinic_id,),
                )
            row = cursor.fetchone()
        if not row:
            who = f"email={email!r}" if email else "the oldest active doctor"
            raise RuntimeError(
                f"Migration-user lookup failed for {who} in clinic {clinic_id}. "
                "Seed the clinic before running the migration."
            )
        return str(row["id"])

    def count_migrated_patients(self, clinic_id: str) -> int:
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS n FROM patients
                WHERE clinic_id = %s
                  AND legacy_id IS NOT NULL
                  AND deleted_at IS NULL
                """,
                (clinic_id,),
            )
            row = cursor.fetchone()
        return int(row["n"]) if row else 0

    def count_duplicate_name_patients(self, clinic_id: str) -> int:
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS n FROM patients
                WHERE clinic_id = %s
                  AND has_name_duplicate = true
                  AND legacy_id IS NOT NULL
                  AND deleted_at IS NULL
                """,
                (clinic_id,),
            )
            row = cursor.fetchone()
        return int(row["n"]) if row else 0

    def count_migrated_visits(self, clinic_id: str) -> int:
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS n FROM visits
                WHERE clinic_id = %s
                  AND legacy_id IS NOT NULL
                  AND deleted_at IS NULL
                """,
                (clinic_id,),
            )
            row = cursor.fetchone()
        return int(row["n"]) if row else 0

    def visit_date_range(self, clinic_id: str) -> tuple[Any, Any]:
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT MIN(visit_date) AS min_d, MAX(visit_date) AS max_d
                FROM visits
                WHERE clinic_id = %s
                  AND legacy_id IS NOT NULL
                  AND deleted_at IS NULL
                """,
                (clinic_id,),
            )
            row = cursor.fetchone()
        if not row:
            return (None, None)
        return (row["min_d"], row["max_d"])

    def payment_code_histogram(self, clinic_id: str) -> dict[str, int]:
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COALESCE(payment_code, '∅') AS code, COUNT(*) AS n
                FROM visits
                WHERE clinic_id = %s
                  AND legacy_id IS NOT NULL
                  AND deleted_at IS NULL
                GROUP BY 1
                ORDER BY 1
                """,
                (clinic_id,),
            )
            rows = cursor.fetchall()
        return {row["code"]: int(row["n"]) for row in rows}

    def load_patient_lookup(self, clinic_id: str) -> dict[str, str]:
        """Build {legacy_display_name: patient_id} for one clinic.

        Loaded once at the start of the visit-import phase so the 220k
        row loop does O(1) hash lookups instead of 220k DB round-trips
        (see ADR-012 lookup decision). At ~11k patients the dict is a
        few megabytes.

        Patients without a legacy_display_name (created post-migration
        through the API) are skipped — they cannot be the FK target of
        any legacy visit row.
        """
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, legacy_display_name
                FROM patients
                WHERE clinic_id = %s
                  AND legacy_display_name IS NOT NULL
                  AND deleted_at IS NULL
                """,
                (clinic_id,),
            )
            rows = cursor.fetchall()
        return {row["legacy_display_name"]: str(row["id"]) for row in rows}

    def upsert_patient(self, clinic_id: str, p: PatientUpsertInput) -> str:
        """Idempotent insert keyed on (clinic_id, legacy_id).

        Returns the patient UUID. Re-running the migration updates any
        previously-imported row in place (ADR-010 idempotency).
        """
        sql = """
            INSERT INTO patients (
              clinic_id, legacy_id, legacy_display_name, has_name_duplicate,
              first_name, last_name, date_of_birth, place_of_birth,
              birth_weight_g, birth_head_circumference_cm, birth_length_cm,
              alergji_tjera, phone
            )
            VALUES (
              %(clinic_id)s, %(legacy_id)s, %(legacy_display_name)s, %(has_name_duplicate)s,
              %(first_name)s, %(last_name)s, %(date_of_birth)s, %(place_of_birth)s,
              %(birth_weight_g)s, %(birth_head_circumference_cm)s, %(birth_length_cm)s,
              %(alergji_tjera)s, %(phone)s
            )
            ON CONFLICT (clinic_id, legacy_id) DO UPDATE SET
              legacy_display_name = EXCLUDED.legacy_display_name,
              has_name_duplicate = EXCLUDED.has_name_duplicate,
              first_name = EXCLUDED.first_name,
              last_name = EXCLUDED.last_name,
              date_of_birth = EXCLUDED.date_of_birth,
              place_of_birth = EXCLUDED.place_of_birth,
              birth_weight_g = EXCLUDED.birth_weight_g,
              birth_head_circumference_cm = EXCLUDED.birth_head_circumference_cm,
              birth_length_cm = EXCLUDED.birth_length_cm,
              alergji_tjera = EXCLUDED.alergji_tjera,
              phone = EXCLUDED.phone,
              updated_at = now()
            RETURNING id
        """
        params: dict[str, Any] = {
            "clinic_id": clinic_id,
            "legacy_id": p.legacy_id,
            "legacy_display_name": p.legacy_display_name,
            "has_name_duplicate": p.has_name_duplicate,
            "first_name": p.first_name,
            "last_name": p.last_name,
            "date_of_birth": p.date_of_birth,
            "place_of_birth": p.place_of_birth,
            "birth_weight_g": p.birth_weight_g,
            "birth_head_circumference_cm": p.birth_head_circumference_cm,
            "birth_length_cm": p.birth_length_cm,
            "alergji_tjera": p.alergji_tjera,
            "phone": p.phone,
        }
        with self._conn.cursor() as cursor:
            cursor.execute(sql, params)
            row = cursor.fetchone()
        assert row is not None  # noqa: S101 — INSERT...RETURNING always yields a row
        return str(row["id"])

    def apply_sex_for_names(
        self,
        clinic_id: str,
        first_names: list[str],
        sex: str,
    ) -> int:
        """Set sex=? on migrated patients whose first_name is in the list.

        Only touches rows where:
          * clinic_id matches (multi-tenant safety, also enforced by RLS)
          * legacy_id IS NOT NULL (manually-created patients are off-limits)
          * sex IS NULL (never overwrite an explicit value)
          * sex_inferred = false (the column default; flips to true here)
          * deleted_at IS NULL (don't resurrect soft-deleted rows)

        Returns the number of rows updated. Empty `first_names` is a no-op
        and returns 0 — the SQL `= ANY(%s::text[])` clause would still be
        valid with an empty array, but skipping the round-trip is cleaner.
        """
        if not first_names:
            return 0
        if sex not in ("m", "f"):
            raise ValueError(f"sex must be 'm' or 'f', got {sex!r}")
        sql = """
            UPDATE patients
            SET sex = %(sex)s::patient_sex,
                sex_inferred = true,
                updated_at = now()
            WHERE clinic_id = %(clinic_id)s
              AND legacy_id IS NOT NULL
              AND sex IS NULL
              AND sex_inferred = false
              AND deleted_at IS NULL
              AND first_name = ANY(%(names)s::text[])
        """
        with self._conn.cursor() as cursor:
            cursor.execute(sql, {"sex": sex, "clinic_id": clinic_id, "names": first_names})
            return cursor.rowcount

    def count_null_sex_after_apply(self, clinic_id: str) -> int:
        """How many migrated rows still have sex IS NULL post-apply.

        Drives the `patients_left_null` count in the audit_log payload
        — Dr. Taulant's manual-review bucket.
        """
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT COUNT(*) AS n FROM patients
                WHERE clinic_id = %s
                  AND legacy_id IS NOT NULL
                  AND sex IS NULL
                  AND deleted_at IS NULL
                """,
                (clinic_id,),
            )
            row = cursor.fetchone()
        return int(row["n"]) if row else 0

    def write_sex_inference_audit_log(
        self,
        *,
        clinic_id: str,
        user_id: str,
        payload: dict[str, Any],
    ) -> str:
        """Append one audit_log row summarising the inference run.

        resource_type='clinic' because this is a clinic-wide operation;
        resource_id=clinic_id keeps the row queryable by clinic. The
        migration tool synthesises non-PHI placeholders for the NOT-NULL
        operational columns (ip_address, user_agent, session_id) since
        it runs offline.
        """
        sql = """
            INSERT INTO audit_log (
              clinic_id, user_id, action, resource_type, resource_id,
              changes, ip_address, user_agent, session_id
            )
            VALUES (
              %(clinic_id)s, %(user_id)s, 'sex_inference_applied',
              'clinic', %(clinic_id)s,
              %(changes)s::jsonb,
              '127.0.0.1'::inet,
              'klinika-migrate/slice-17.5',
              %(session_id)s
            )
            RETURNING id
        """
        session_id = f"sex-inference-{payload.get('schema_version')}-{payload.get('culture')}"
        params: dict[str, Any] = {
            "clinic_id": clinic_id,
            "user_id": user_id,
            "changes": json.dumps(payload, ensure_ascii=False),
            "session_id": session_id,
        }
        with self._conn.cursor() as cursor:
            cursor.execute(sql, params)
            row = cursor.fetchone()
        assert row is not None  # noqa: S101 — INSERT...RETURNING always yields a row
        return str(row["id"])

    def upsert_visit(
        self,
        clinic_id: str,
        migration_user_id: str,
        v: VisitUpsertInput,
    ) -> str:
        """Idempotent insert keyed on (clinic_id, legacy_id).

        Migrated visits land at status='completed', scheduled_for=NULL,
        is_walk_in=false (no booking concept in the source). All
        attributable to the migration user (Dr. Taulant for DonetaMED).
        """
        sql = """
            INSERT INTO visits (
              clinic_id, patient_id, legacy_id,
              visit_date, scheduled_for, is_walk_in, status,
              complaint, feeding_notes,
              weight_g, height_cm, head_circumference_cm, temperature_c,
              payment_code, examinations, ultrasound_notes, legacy_diagnosis,
              prescription, lab_results, followup_notes, other_notes,
              created_by, updated_by
            )
            VALUES (
              %(clinic_id)s, %(patient_id)s, %(legacy_id)s,
              %(visit_date)s, NULL, false, 'completed',
              %(complaint)s, %(feeding_notes)s,
              %(weight_g)s, %(height_cm)s, %(head_circumference_cm)s, %(temperature_c)s,
              %(payment_code)s, %(examinations)s, %(ultrasound_notes)s, %(legacy_diagnosis)s,
              %(prescription)s, %(lab_results)s, %(followup_notes)s, %(other_notes)s,
              %(user_id)s, %(user_id)s
            )
            ON CONFLICT (clinic_id, legacy_id) DO UPDATE SET
              patient_id = EXCLUDED.patient_id,
              visit_date = EXCLUDED.visit_date,
              complaint = EXCLUDED.complaint,
              feeding_notes = EXCLUDED.feeding_notes,
              weight_g = EXCLUDED.weight_g,
              height_cm = EXCLUDED.height_cm,
              head_circumference_cm = EXCLUDED.head_circumference_cm,
              temperature_c = EXCLUDED.temperature_c,
              payment_code = EXCLUDED.payment_code,
              examinations = EXCLUDED.examinations,
              ultrasound_notes = EXCLUDED.ultrasound_notes,
              legacy_diagnosis = EXCLUDED.legacy_diagnosis,
              prescription = EXCLUDED.prescription,
              lab_results = EXCLUDED.lab_results,
              followup_notes = EXCLUDED.followup_notes,
              other_notes = EXCLUDED.other_notes,
              updated_by = EXCLUDED.updated_by,
              updated_at = now()
            RETURNING id
        """
        params: dict[str, Any] = {
            "clinic_id": clinic_id,
            "patient_id": v.patient_id,
            "legacy_id": v.legacy_id,
            "visit_date": v.visit_date,
            "complaint": v.complaint,
            "feeding_notes": v.feeding_notes,
            "weight_g": v.weight_g,
            "height_cm": v.height_cm,
            "head_circumference_cm": v.head_circumference_cm,
            "temperature_c": v.temperature_c,
            "payment_code": v.payment_code,
            "examinations": v.examinations,
            "ultrasound_notes": v.ultrasound_notes,
            "legacy_diagnosis": v.legacy_diagnosis,
            "prescription": v.prescription,
            "lab_results": v.lab_results,
            "followup_notes": v.followup_notes,
            "other_notes": v.other_notes,
            "user_id": migration_user_id,
        }
        with self._conn.cursor() as cursor:
            cursor.execute(sql, params)
            row = cursor.fetchone()
        assert row is not None  # noqa: S101
        return str(row["id"])
