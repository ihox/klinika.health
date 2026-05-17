// Phase 2b — unit tests for the shared walk-in arrived_at policy.
//
// Two concerns:
//   1. `snapToFiveMinutesUtc` (pure helper) — snap rounding under
//      different UTC clock positions, including the edges where
//      Math.round flips.
//   2. `VisitsCalendarService.computeWalkInArrivedAt` — drives the
//      service method with a stub Prisma client so we can assert the
//      snap-and-stack behaviour described in CLAUDE.md / ADR-011
//      without spinning a real DB. Stubbing keeps these tests in the
//      same "fast unit" lane as the rest of the visits-calendar specs.
//
// The integration-level guarantees (audit log row written, real
// Postgres CHECK constraint enforced, etc.) live in the separately
// gated `visits-calendar.integration.spec.ts`.

import { describe, expect, it, vi } from 'vitest';

import {
  VisitsCalendarService,
  snapToFiveMinutesUtc,
} from './visits-calendar.service';

describe('snapToFiveMinutesUtc', () => {
  it('snaps a 3-minute offset up to the next boundary', () => {
    // 10:03:00Z → 10:05:00Z (2 min from :05, 3 min from :00).
    expect(snapToFiveMinutesUtc(new Date('2026-05-15T10:03:00Z'))).toEqual(
      new Date('2026-05-15T10:05:00Z'),
    );
  });

  it('snaps a 2-minute offset down to the prior boundary', () => {
    // 10:02:00Z → 10:00:00Z (2 min from :00 wins over 3 from :05).
    expect(snapToFiveMinutesUtc(new Date('2026-05-15T10:02:00Z'))).toEqual(
      new Date('2026-05-15T10:00:00Z'),
    );
  });

  it('rounds half-up at the 2:30 midpoint via Math.round semantics', () => {
    expect(snapToFiveMinutesUtc(new Date('2026-05-15T10:02:30Z'))).toEqual(
      new Date('2026-05-15T10:05:00Z'),
    );
  });

  it('is a no-op when already on a 5-minute boundary', () => {
    expect(snapToFiveMinutesUtc(new Date('2026-05-15T11:50:00Z'))).toEqual(
      new Date('2026-05-15T11:50:00Z'),
    );
  });

  it('zeros out sub-minute precision', () => {
    expect(
      snapToFiveMinutesUtc(new Date('2026-05-15T10:04:59.999Z')),
    ).toEqual(new Date('2026-05-15T10:05:00Z'));
  });
});

// ---------------------------------------------------------------------------
// computeWalkInArrivedAt
// ---------------------------------------------------------------------------

/**
 * Build a `VisitsCalendarService` instance wired against a stub Prisma
 * client whose `visit.findMany` returns the supplied fixture. The
 * other collaborators (audit, calendar events) aren't exercised by
 * `computeWalkInArrivedAt`, so they pass through as `null` casts.
 */
function makeService(
  existingWalkIns: Array<{ arrivedAt: Date; durationMinutes: number | null }>,
): VisitsCalendarService {
  const prismaStub = {
    visit: {
      findMany: vi.fn().mockResolvedValue(existingWalkIns),
    },
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return new VisitsCalendarService(
    prismaStub as any,
    null as any,
    null as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

describe('VisitsCalendarService.computeWalkInArrivedAt', () => {
  const CLINIC = 'clinic-uuid';

  it('snaps the intended time when there are no other walk-ins today', async () => {
    const svc = makeService([]);
    const result = await svc.computeWalkInArrivedAt(
      CLINIC,
      new Date('2026-05-15T08:03:00Z'),
    );
    // 08:03Z snaps up to 08:05Z (no collisions).
    expect(result).toEqual(new Date('2026-05-15T08:05:00Z'));
  });

  it('stacks by 5 min when the snapped slot is occupied (duration=5)', async () => {
    const svc = makeService([
      { arrivedAt: new Date('2026-05-15T08:05:00Z'), durationMinutes: 5 },
    ]);
    // Intended 08:04 → snaps to 08:05 → collides → +5 → 08:10.
    const result = await svc.computeWalkInArrivedAt(
      CLINIC,
      new Date('2026-05-15T08:04:00Z'),
    );
    expect(result).toEqual(new Date('2026-05-15T08:10:00Z'));
  });

  it('skips the whole occupied window when duration is larger than the step (duration=10)', async () => {
    const svc = makeService([
      // Existing walk-in at 08:05 occupies [08:05, 08:15).
      { arrivedAt: new Date('2026-05-15T08:05:00Z'), durationMinutes: 10 },
    ]);
    const result = await svc.computeWalkInArrivedAt(
      CLINIC,
      new Date('2026-05-15T08:05:00Z'),
    );
    // Stack-and-snap advances by 5 until 08:15 (first free slot).
    expect(result).toEqual(new Date('2026-05-15T08:15:00Z'));
  });

  it('places a non-colliding intended time at its own snapped boundary', async () => {
    const svc = makeService([
      { arrivedAt: new Date('2026-05-15T08:05:00Z'), durationMinutes: 5 },
    ]);
    const result = await svc.computeWalkInArrivedAt(
      CLINIC,
      new Date('2026-05-15T11:50:00Z'),
    );
    expect(result).toEqual(new Date('2026-05-15T11:50:00Z'));
  });

  it('treats legacy null-duration rows as occupying at least one 5-min cell', async () => {
    const svc = makeService([
      { arrivedAt: new Date('2026-05-15T08:05:00Z'), durationMinutes: null },
    ]);
    const result = await svc.computeWalkInArrivedAt(
      CLINIC,
      new Date('2026-05-15T08:05:00Z'),
    );
    expect(result).toEqual(new Date('2026-05-15T08:10:00Z'));
  });

  it('caps stacking at 50 iterations and returns the final candidate', async () => {
    // Synthesize 60 contiguous 5-min walk-ins from 09:00Z — far more
    // than the 50-iter safety cap. The helper returns the last
    // candidate so the caller still gets a usable Date.
    const fixture = Array.from({ length: 60 }, (_, i) => ({
      arrivedAt: new Date(2026, 4, 15, 9, i * 5),
      durationMinutes: 5,
    }));
    const svc = makeService(fixture);
    const result = await svc.computeWalkInArrivedAt(
      CLINIC,
      new Date(2026, 4, 15, 9, 0),
    );
    // Snapped 09:00 + 50 × 5 min = 13:10 local (the cap exit).
    expect(result.getHours()).toBe(13);
    expect(result.getMinutes()).toBe(10);
  });
});
