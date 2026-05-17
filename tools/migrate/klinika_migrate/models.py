"""Plain-data classes used by the import phases and the DB layer.

Extracted from db.py so that test code (and the parser/import phases)
can import these dataclasses without pulling in psycopg as a
transitive dependency.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal


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
    # Verbatim Datelindja text when the row fell back to
    # UNKNOWN_DOB_SENTINEL. NULL on every patient whose DOB parsed
    # cleanly. See ADR-017 and apps/api/.../patients.service.ts
    # UNKNOWN_DOB_SENTINEL.
    legacy_dob_raw: str | None


@dataclass(frozen=True)
class VisitUpsertInput:
    legacy_id: int
    patient_id: str
    visit_date: date
    complaint: str | None
    feeding_notes: str | None
    weight_g: int | None
    height_cm: Decimal | None
    head_circumference_cm: Decimal | None
    temperature_c: Decimal | None
    payment_code: str | None
    examinations: str | None
    ultrasound_notes: str | None
    legacy_diagnosis: str | None
    prescription: str | None
    lab_results: str | None
    followup_notes: str | None
    other_notes: str | None
