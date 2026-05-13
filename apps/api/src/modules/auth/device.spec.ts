import { describe, expect, it } from 'vitest';

import { labelFromUserAgent, maskEmail } from './device';

describe('labelFromUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      /^Chrome · Mac/,
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      /Safari · iOS/,
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
      /^Firefox · Windows$/,
    ],
  ])('parses %s', (ua, pattern) => {
    expect(labelFromUserAgent(ua)).toMatch(pattern);
  });

  it('falls back when the UA is unrecognized', () => {
    expect(labelFromUserAgent('')).toBe('Klient i panjohur');
    expect(labelFromUserAgent('something-weird/1.0')).toBe('Klient i panjohur');
  });
});

describe('maskEmail', () => {
  it.each([
    // First and last chars of the local part survive; everything in
    // between collapses to a Unicode horizontal ellipsis. Short
    // (≤ 2 char) locals expose only the first char.
    ['taulant.shala@donetamed.health', 't…a@donetamed.health'],
    ['ab@x.com', 'a…@x.com'],
    ['a@x.com', 'a…@x.com'],
  ])('%s → %s', (input, expected) => {
    expect(maskEmail(input)).toBe(expected);
  });

  it('returns the input unchanged when there is no @', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email');
  });
});
