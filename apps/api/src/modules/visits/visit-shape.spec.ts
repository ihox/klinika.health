import { describe, expect, it } from 'vitest';

import { classifyVisitShape } from './visit-shape';

describe('classifyVisitShape', () => {
  it('classifies a row with scheduled_for set as "scheduled"', () => {
    expect(
      classifyVisitShape({
        scheduledFor: new Date('2026-05-15T10:30:00Z'),
        isWalkIn: false,
      }),
    ).toBe('scheduled');
  });

  it('classifies a walk-in (scheduled_for=null, is_walk_in=true) as "walk_in"', () => {
    expect(
      classifyVisitShape({
        scheduledFor: null,
        isWalkIn: true,
      }),
    ).toBe('walk_in');
  });

  it('classifies a row with no schedule and no walk-in flag as "standalone"', () => {
    expect(
      classifyVisitShape({
        scheduledFor: null,
        isWalkIn: false,
      }),
    ).toBe('standalone');
  });

  it('accepts a string-typed scheduled_for (serialized DTO shape)', () => {
    expect(
      classifyVisitShape({
        scheduledFor: '2026-05-15T10:30:00.000Z',
        isWalkIn: false,
      }),
    ).toBe('scheduled');
  });

  it('treats an empty string scheduled_for as truthy, classifying as "scheduled"', () => {
    // Documenting the chosen behaviour: the helper checks `!= null`, so
    // any non-null string (including "") is treated as a schedule. In
    // practice the column is either null or an ISO instant; this guards
    // future serializers that might emit "" for unset fields without
    // silently re-classifying.
    expect(
      classifyVisitShape({
        scheduledFor: '',
        isWalkIn: false,
      }),
    ).toBe('scheduled');
  });

  it('classifies an inconsistent row (scheduled_for set AND is_walk_in=true) as "scheduled"', () => {
    // The DB CHECK constraint forbids this combination. The classifier
    // picks 'scheduled' defensively so a corrupted row still surfaces
    // on the calendar feed (a slot has been claimed).
    expect(
      classifyVisitShape({
        scheduledFor: new Date('2026-05-15T10:30:00Z'),
        isWalkIn: true,
      }),
    ).toBe('scheduled');
  });

  it('is a pure function — repeated calls return the same shape', () => {
    const row = { scheduledFor: null, isWalkIn: false };
    expect(classifyVisitShape(row)).toBe('standalone');
    expect(classifyVisitShape(row)).toBe('standalone');
    expect(classifyVisitShape(row)).toBe('standalone');
  });
});
