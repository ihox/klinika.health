// Pino redaction paths for fields that may contain PHI.
//
// CLAUDE.md §1.3 forbids PHI in operational logs. Pino's `redact`
// option rewrites these paths to `[Redacted]` at serialization time, so
// even a logger.info({ patient }, '...') call that accidentally spreads
// a Prisma row never emits the contents. The list is intentionally
// generous: every free-text clinical field, every name, every contact
// detail, and every nested form-payload variant we expect from the
// visit auto-save shape.
//
// Pino expects a flat array of paths, with `*` as a single-level
// wildcard. The patterns below cover:
//
//   1. Top-level keys           e.g. firstName, diagnosis
//   2. Nested under `patient`    e.g. patient.firstName
//   3. Nested under `visit`      e.g. visit.complaint
//   4. Nested under `body`       e.g. body.prescription (Nest request bodies)
//   5. Nested under `req.body`   e.g. req.body.notes (pino-http)
//   6. Nested under `payload`    e.g. payload.diagnosis
//   7. One level of array element wildcard for diff arrays.
//
// `email` is redacted by default; the auth subsystem will whitelist it
// explicitly when logging login/MFA events (those need the email for
// account correlation and are themselves audit-logged).

const PHI_FIELD_NAMES = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'dob',
  'birthDate',
  'placeOfBirth',
  'diagnosis',
  'legacyDiagnosis',
  'prescription',
  'notes',
  'complaint',
  'alergjiTjera',
  'alergji_tjera',
  'examinations',
  'ultrasoundNotes',
  'ultrasound_notes',
  'labResults',
  'lab_results',
  'followupNotes',
  'followup_notes',
  'otherNotes',
  'other_notes',
  'feedingNotes',
  'feeding_notes',
  'phone',
  'email',
  'address',
  'diagnosisSnapshot',
  'diagnosis_snapshot',
] as const;

const NESTING_PREFIXES = [
  '',
  'patient.',
  'visit.',
  'entry.',
  'body.',
  'req.body.',
  'request.body.',
  'payload.',
  'data.',
  'old.',
  'new.',
] as const;

function buildRedactPaths(): readonly string[] {
  const out: string[] = [];
  for (const prefix of NESTING_PREFIXES) {
    for (const field of PHI_FIELD_NAMES) {
      out.push(`${prefix}${field}`);
    }
  }
  // Audit-style change diff: arrays of { field, old, new }. We can't
  // know which entries carry PHI, so redact the values wholesale when
  // we see a `changes` array. Callers that need diff content for
  // legitimate audit display fetch the row through the audit service
  // (which doesn't go through this logger).
  out.push('changes[*].old', 'changes[*].new');
  out.push('*.changes[*].old', '*.changes[*].new');
  return out;
}

export const PHI_REDACT_PATHS: readonly string[] = buildRedactPaths();

export const PHI_REDACT_CENSOR = '[Redacted]';
