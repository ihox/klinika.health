-- Flip the schema-level default for `visits.status` from 'completed' to
-- 'in_progress'. Doctor-driven creation paths (POST /api/visits,
-- POST /api/visits/doctor-new standalone branch) relied on this default
-- and were producing rows born 'completed' — the "Përfundo vizitën"
-- button was never reachable for them because the visit looked finished
-- at insert time. Service code now sets status explicitly per path
-- (in_progress for doctor-driven, arrived for receptionist walk-ins,
-- scheduled for bookings); this DEFAULT is a sane fallback in case any
-- future insert ever omits status entirely.

ALTER TABLE "visits" ALTER COLUMN "status" SET DEFAULT 'in_progress';
