// Visit-shape classifier.
//
// Post-merge (ADR-011, ADR-013) the unified `visits` table holds three
// distinct row shapes — three different operational stories told by
// different combinations of `scheduled_for` and `is_walk_in`:
//
//   shape       | scheduled_for | is_walk_in | typical creator
//   ----------- | ------------- | ---------- | ----------------------------
//   scheduled   | NOT NULL      | false      | receptionist booking
//   walk_in     | NULL          | true       | walk-in (paired with booking)
//   standalone  | NULL          | false      | doctor's "+ Vizitë e re"
//                                              with no schedule to pair to,
//                                              or legacy POST /api/visits
//
// `paired_with_visit_id` rides ONLY on `walk_in` rows by DB CHECK
// constraint, so it adds no discriminating signal beyond `is_walk_in`.
//
// This helper is pure (no DB access). It's the single chokepoint
// every reader uses to ask "which of the three is this?" — keeping
// the question localized means future shape additions stay easy to
// audit.

export type VisitShape = 'scheduled' | 'walk_in' | 'standalone';

/**
 * Subset of the visit columns the classifier needs. Designed to accept
 * either a full Prisma `Visit` row or a slim `select` — callers pick
 * their own fields and the structural type compiles either way.
 */
export interface ClassifiableVisit {
  scheduledFor: Date | string | null;
  isWalkIn: boolean;
}

/**
 * Classify a visit row into one of the three operational shapes.
 *
 * The match order is deliberate:
 *   1. `scheduled_for IS NOT NULL` → 'scheduled' (a booking is always
 *      a booking, even if it later picked up walk-in metadata via a
 *      data-correction path that doesn't exist today).
 *   2. `is_walk_in` → 'walk_in' (already excluded scheduled in step 1).
 *   3. Otherwise → 'standalone'.
 *
 * If the row carries both `scheduled_for` AND `is_walk_in=true` the DB
 * CHECK constraint should have refused it — but the classifier picks
 * 'scheduled' defensively, matching the calendar feed's "this row has
 * a slot" semantics.
 */
export function classifyVisitShape(visit: ClassifiableVisit): VisitShape {
  if (visit.scheduledFor != null) return 'scheduled';
  if (visit.isWalkIn) return 'walk_in';
  return 'standalone';
}
