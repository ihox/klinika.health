-- Drop the 'cancelled' value from the visit status set, collapsing any
-- existing cancelled rows into 'no_show'. Decision after UX review: the
-- distinction between "appointment cancelled before it happened" and
-- "patient didn't arrive without notice" doesn't matter for Dr. Taulant's
-- workflow at DonetaMED — both surface as "Mungesë" to the receptionist
-- and the clinical record looks identical in either case.
--
-- visits.status is TEXT + CHECK (see 20260514170000_visits_absorb_appointments),
-- not a Postgres ENUM, so this is a constraint swap rather than the
-- enum swap-and-rename pattern.
--
-- Forward-only and idempotent: the UPDATE is a no-op once run; the
-- constraint drop/add succeeds even if the migration is replayed against
-- a database whose constraint already matches the new shape (DROP …
-- IF EXISTS handles the redo case).
--
-- The default value ('in_progress', set by 20260519120000) is unaffected.

UPDATE "visits"
   SET "status" = 'no_show'
 WHERE "status" = 'cancelled';

ALTER TABLE "visits"
  DROP CONSTRAINT IF EXISTS "visits_status_check";

ALTER TABLE "visits"
  ADD CONSTRAINT "visits_status_check"
  CHECK ("status" IN (
    'scheduled',
    'arrived',
    'in_progress',
    'completed',
    'no_show'
  ));
