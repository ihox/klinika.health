// Patient completeness predicate — the single source of truth for
// "can the doctor proceed to the chart?". Used by the frontend to
// route conditional navigation, and computed server-side into
// `PatientFullDto.isComplete` so both sides see the same answer.
//
// Required fields: firstName, lastName, dateOfBirth, sex.
//
// Patients can land in the database missing some of these when the
// receptionist quick-adds them (CLAUDE.md §1.2 — receptionist sees
// only name + DOB; the receptionist's add-patient flow is even
// looser, requiring firstName only). Until the doctor fills them
// in, the chart cannot render meaningfully (no growth charts, no
// vërtetim, no print).
//
// The empty-string case is load-bearing: the receptionist's quick-add
// may store `lastName = ''` (column is NOT NULL but the value is
// blank). `Boolean('') === false`, so the predicate still returns
// false for that patient — they're routed to the master-data form.

export interface PatientCompletenessFields {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  sex?: string | null;
}

export function isPatientComplete(p: PatientCompletenessFields): boolean {
  return Boolean(p.firstName && p.lastName && p.dateOfBirth && p.sex);
}
