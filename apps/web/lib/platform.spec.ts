// Pure-function tests for the OS-detection helper used by the
// doctor's global patient search (and any future surface that needs
// a Cmd vs Ctrl affordance). The runtime `isMac` constant is read at
// module load from `navigator`; these tests exercise the pure
// detector directly so we don't depend on a jsdom polyfill.

import { describe, expect, it } from 'vitest';

import { isMacPlatform, modKShortcutFor } from './platform';

describe('isMacPlatform', () => {
  it('returns true for the classic macOS platform string', () => {
    expect(isMacPlatform('MacIntel')).toBe(true);
  });

  it('returns true for the userAgentData Mac platform name', () => {
    // Chrome's `navigator.userAgentData.platform` returns "macOS"
    // (lowercase m); Safari's legacy `navigator.platform` returns
    // "MacIntel". Both must resolve.
    expect(isMacPlatform('macOS')).toBe(true);
  });

  it('returns true for iPhone and iPad (touch Safari)', () => {
    expect(isMacPlatform('iPhone')).toBe(true);
    expect(isMacPlatform('iPad')).toBe(true);
    expect(isMacPlatform('iOS')).toBe(true);
  });

  it('returns false for Windows', () => {
    expect(isMacPlatform('Win32')).toBe(false);
    expect(isMacPlatform('Windows')).toBe(false);
  });

  it('returns false for Linux', () => {
    expect(isMacPlatform('Linux x86_64')).toBe(false);
    expect(isMacPlatform('Linux')).toBe(false);
  });

  it('returns false for an empty / unknown platform', () => {
    expect(isMacPlatform('')).toBe(false);
    expect(isMacPlatform('Unknown')).toBe(false);
  });
});

describe('modKShortcutFor', () => {
  it('renders ⌘K on Mac platforms', () => {
    expect(modKShortcutFor('MacIntel')).toBe('⌘K');
    expect(modKShortcutFor('iPhone')).toBe('⌘K');
  });

  it('renders Ctrl+K on Windows', () => {
    expect(modKShortcutFor('Win32')).toBe('Ctrl+K');
  });

  it('renders Ctrl+K on Linux', () => {
    expect(modKShortcutFor('Linux x86_64')).toBe('Ctrl+K');
  });
});
