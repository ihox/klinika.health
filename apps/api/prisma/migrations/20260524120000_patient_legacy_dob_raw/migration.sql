-- Patients whose Access "Datelindja" text couldn't be parsed at
-- import time (year-only "2018", typo'd "21 vjeq", or missing)
-- land with date_of_birth = UNKNOWN_DOB_SENTINEL ('1900-01-01').
-- The UI's existing isPatientComplete predicate already routes them
-- into the master-data completion queue.
--
-- This column preserves the original Datelindja string verbatim
-- so Dr. Taulant can triage the queue: "ah, this child's parents
-- only knew the birth year" vs. "this row was a data-entry typo."
-- Without it the original signal is lost the moment the sentinel
-- date hits the column.
--
-- NULL for any patient whose DOB parsed cleanly (the vast majority)
-- and for any patient created post-migration through the UI.
--
-- Forward-only and idempotent: IF NOT EXISTS makes the migration
-- safe to replay against a database that already has the column.

ALTER TABLE "patients"
  ADD COLUMN IF NOT EXISTS "legacy_dob_raw" TEXT;
