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
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Iterator

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row


@dataclass(frozen=True)
class PatientUpsertInput:
    legacy_id: int
    legacy_display_name: str
    has_name_duplicate: bool
    first_name: str
    last_name: str
    date_of_birth: date
    place_of_birth: str | None
    birth_weight_g: int | None
    birth_head_circumference_cm: Decimal | None
    birth_length_cm: Decimal | None
    alergji_tjera: str | None
    phone: str | None


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
                        "Could not SET ROLE platform_admin_role — the migration tool needs a "
                        "BYPASSRLS role. Either connect as a superuser/dev owner or "
                        "GRANT platform_admin_role to the connection role."
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
