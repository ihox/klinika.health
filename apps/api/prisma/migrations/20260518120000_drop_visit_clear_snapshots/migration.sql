-- Drop the "Pastro vizitën" undo snapshot table.
--
-- Pastro vizitën was a destructive clear-and-undo affordance. It is
-- being removed in favour of an append-only edit model: status changes
-- are reversible via "Anulo statusin" (no data wiped) and edits flow
-- through the auto-save path with field-level audit diffs.
--
-- The `visit_clear_snapshots` rows were short-lived by design (15s TTL
-- on `expires_at`) and represent transient undo state, not historical
-- record. Dropping is safe: any in-flight snapshot at deploy time would
-- only have lost its undo window, which the matching frontend removal
-- already gives up.
--
-- Historical `visit.cleared` / `visit.cleared.undone` audit rows remain
-- in `audit_log` — those are records of past clinical events, not
-- pending state.

DROP TABLE IF EXISTS "visit_clear_snapshots";
