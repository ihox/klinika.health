-- Phase 2b — clinic walk-in default duration.
--
-- Walk-ins (`is_walk_in = true`, `scheduled_for = null`) previously had
-- `duration_minutes = null` regardless of where they were created. The
-- doctor's home and the receptionist calendar both want a positive
-- duration so the row reserves space in the day. Per CLAUDE.md §1.14
-- the duration is per-clinic configurable; default is 5 min (matches
-- the snap-and-stack helper introduced in the same slice).
--
-- Range: 5–60 min. The lower bound matches the snap unit; the upper
-- bound prevents a single walk-in from accidentally dominating a 1h
-- block.

ALTER TABLE "clinics"
  ADD COLUMN "walkin_duration_minutes" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "clinics"
  ADD CONSTRAINT "clinics_walkin_duration_minutes_range_check"
  CHECK ("walkin_duration_minutes" >= 5 AND "walkin_duration_minutes" <= 60);
