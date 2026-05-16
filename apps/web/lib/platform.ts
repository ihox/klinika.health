// Client-side OS detection for keyboard-shortcut affordances.
//
// `navigator.platform` is deprecated but still the only synchronous,
// universally-available signal — the modern `navigator.userAgentData`
// is gated behind Permissions-Policy on Firefox/Safari. The fallback
// chain mirrors what Slack, Linear, and Notion ship in production.

/**
 * Pure detector — exported for unit tests. The runtime read from
 * `navigator` lives in `detectIsMac` below.
 *
 * Matches both the legacy `navigator.platform` strings ("MacIntel",
 * "iPhone", "iPad") and the modern `navigator.userAgentData.platform`
 * values ("macOS", "iOS"). The match is case-insensitive so Chrome's
 * lowercase "macOS" and Safari's mixed-case "MacIntel" both resolve.
 */
export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ios/i.test(platform);
}

function detectIsMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & {
    userAgentData?: { platform?: string };
  }).userAgentData;
  const platform = uaData?.platform ?? navigator.platform ?? '';
  return isMacPlatform(platform);
}

export const isMac: boolean = detectIsMac();

/** Display label for the Cmd/Ctrl meta key per OS. */
export const modKeyLabel: string = isMac ? '⌘' : 'Ctrl';

/** Display label for the global search shortcut (⌘K vs Ctrl+K). */
export const modKShortcut: string = isMac ? '⌘K' : 'Ctrl+K';

/** Pure helper — exported for unit tests. */
export function modKShortcutFor(platform: string): string {
  return isMacPlatform(platform) ? '⌘K' : 'Ctrl+K';
}

/**
 * True when a keyboard event represents the canonical platform meta
 * modifier — Cmd on Mac, Ctrl elsewhere. Use in place of hand-rolled
 * `e.metaKey || e.ctrlKey` checks so a Mac user pressing Ctrl+K
 * doesn't double-trigger.
 */
export function isModKeyPressed(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}
