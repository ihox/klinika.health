'use client';

import { useEffect, useState } from 'react';

/**
 * Klinika responsive breakpoints (mobile/tablet handoff spec §2).
 *
 *   phone            < 768px      bottom tabs + top app bar, single-pane
 *   tablet-portrait  768–1023px   enlarged top nav, single-pane drilldown
 *   tablet-landscape 1024–1279px  enlarged top nav, split-pane / week grid
 *   desktop          ≥ 1280px     existing desktop UI (untouched)
 *
 * These match the Tailwind breakpoints the CSS layer uses (`md`=768,
 * `lg`=1024, `xl`=1280) so a component can express most differences in
 * CSS and reach for this hook only when the layout *tree* differs
 * (week-grid vs day-list, split-pane vs drilldown) — cases CSS alone
 * can't express.
 */
export type Breakpoint = 'phone' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

/** Lower bound (px, inclusive) for each breakpoint. */
const BREAKPOINTS: { name: Breakpoint; min: number }[] = [
  { name: 'desktop', min: 1280 },
  { name: 'tablet-landscape', min: 1024 },
  { name: 'tablet-portrait', min: 768 },
  { name: 'phone', min: 0 },
];

/** matchMedia queries, ordered narrowest → widest, used as change listeners. */
const QUERIES = [
  '(max-width: 767.98px)',
  '(min-width: 768px) and (max-width: 1023.98px)',
  '(min-width: 1024px) and (max-width: 1279.98px)',
  '(min-width: 1280px)',
];

/** Pure width→breakpoint mapping (exported for unit testing). */
export function breakpointForWidth(width: number): Breakpoint {
  for (const bp of BREAKPOINTS) {
    if (width >= bp.min) return bp.name;
  }
  return 'phone';
}

function readBreakpoint(): Breakpoint {
  // SSR / pre-mount: default to desktop so the server render matches
  // the hydration render (desktop nav is the CSS default at every
  // width via `xl:`-gated markup; the hook only drives tablet/phone
  // structural switches, which resolve after mount).
  if (typeof window === 'undefined') return 'desktop';
  return breakpointForWidth(window.innerWidth);
}

interface UseBreakpointResult {
  /** Current breakpoint. `'desktop'` until the component mounts (SSR-safe). */
  breakpoint: Breakpoint;
  /** True once the client has measured the real viewport. Consumers that
   *  switch component trees can render a neutral state until this flips
   *  to avoid a hydration mismatch / layout flash. */
  mounted: boolean;
  isPhone: boolean;
  isTabletPortrait: boolean;
  isTabletLandscape: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** True for any non-desktop width (where mobile chrome applies). */
  isMobileOrTablet: boolean;
}

/**
 * Reactive current-breakpoint hook. SSR-safe: returns `'desktop'` with
 * `mounted=false` on the server and first client render, then resolves
 * the real breakpoint after mount and updates on viewport changes.
 *
 * Listens on `matchMedia` change events (not a resize poll) so it only
 * re-renders when the active breakpoint band actually changes.
 */
export function useBreakpoint(): UseBreakpointResult {
  const [breakpoint, setBreakpoint] = useState<Breakpoint>('desktop');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setBreakpoint(readBreakpoint());

    if (typeof window.matchMedia !== 'function') return undefined;

    const mqls = QUERIES.map((q) => window.matchMedia(q));
    const onChange = (): void => setBreakpoint(readBreakpoint());

    for (const mql of mqls) {
      // addEventListener('change') is the modern API; addListener is the
      // Safari < 14 fallback. Both are guarded.
      if (typeof mql.addEventListener === 'function') {
        mql.addEventListener('change', onChange);
      } else if (typeof mql.addListener === 'function') {
        mql.addListener(onChange);
      }
    }
    return () => {
      for (const mql of mqls) {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', onChange);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(onChange);
        }
      }
    };
  }, []);

  return {
    breakpoint,
    mounted,
    isPhone: breakpoint === 'phone',
    isTabletPortrait: breakpoint === 'tablet-portrait',
    isTabletLandscape: breakpoint === 'tablet-landscape',
    isTablet: breakpoint === 'tablet-portrait' || breakpoint === 'tablet-landscape',
    isDesktop: breakpoint === 'desktop',
    isMobileOrTablet: breakpoint !== 'desktop',
  };
}
