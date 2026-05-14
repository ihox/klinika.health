import { describe, expect, it } from 'vitest';

import {
  greetingForHour,
  greetingForInstant,
} from './doctor-dashboard.greeting';

describe('greetingForHour', () => {
  it('returns Mirëmëngjes between 05:00 and 11:59', () => {
    expect(greetingForHour(5)).toBe('Mirëmëngjes');
    expect(greetingForHour(8)).toBe('Mirëmëngjes');
    expect(greetingForHour(11)).toBe('Mirëmëngjes');
  });

  it('returns Mirëdita between 12:00 and 17:59', () => {
    expect(greetingForHour(12)).toBe('Mirëdita');
    expect(greetingForHour(14)).toBe('Mirëdita');
    expect(greetingForHour(17)).toBe('Mirëdita');
  });

  it('returns Mirëmbrëma between 18:00 and 22:59', () => {
    expect(greetingForHour(18)).toBe('Mirëmbrëma');
    expect(greetingForHour(21)).toBe('Mirëmbrëma');
    expect(greetingForHour(22)).toBe('Mirëmbrëma');
  });

  it('returns Natë e mbarë between 23:00 and 04:59', () => {
    expect(greetingForHour(23)).toBe('Natë e mbarë');
    expect(greetingForHour(0)).toBe('Natë e mbarë');
    expect(greetingForHour(3)).toBe('Natë e mbarë');
    expect(greetingForHour(4)).toBe('Natë e mbarë');
  });
});

describe('greetingForInstant', () => {
  it('honors Europe/Belgrade in summer (CEST = UTC+2)', () => {
    // 09:30 in Belgrade on a May Wednesday → Mirëmëngjes.
    expect(greetingForInstant(new Date('2026-05-14T07:30:00Z'))).toBe(
      'Mirëmëngjes',
    );
    // 14:00 Belgrade local.
    expect(greetingForInstant(new Date('2026-05-14T12:00:00Z'))).toBe(
      'Mirëdita',
    );
    // 19:00 Belgrade local.
    expect(greetingForInstant(new Date('2026-05-14T17:00:00Z'))).toBe(
      'Mirëmbrëma',
    );
    // 23:30 Belgrade local.
    expect(greetingForInstant(new Date('2026-05-14T21:30:00Z'))).toBe(
      'Natë e mbarë',
    );
  });

  it('honors Europe/Belgrade in winter (CET = UTC+1)', () => {
    // 09:30 Belgrade local in January.
    expect(greetingForInstant(new Date('2026-01-15T08:30:00Z'))).toBe(
      'Mirëmëngjes',
    );
    // 22:30 Belgrade local in January.
    expect(greetingForInstant(new Date('2026-01-15T21:30:00Z'))).toBe(
      'Mirëmbrëma',
    );
  });

  it('does not drift across the DST boundary in March', () => {
    // 04:30 UTC on the CEST onset day (2026-03-29) is 06:30 Belgrade local
    // — well within Mirëmëngjes.
    expect(greetingForInstant(new Date('2026-03-29T04:30:00Z'))).toBe(
      'Mirëmëngjes',
    );
  });

  it('boundary cases land in the later band', () => {
    // 12:00 Belgrade in summer (UTC+2) → 10:00Z.
    expect(greetingForInstant(new Date('2026-05-14T10:00:00Z'))).toBe(
      'Mirëdita',
    );
    // 18:00 Belgrade in summer → 16:00Z.
    expect(greetingForInstant(new Date('2026-05-14T16:00:00Z'))).toBe(
      'Mirëmbrëma',
    );
  });
});
