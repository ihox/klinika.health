import * as React from 'react';
import type { ReactElement } from 'react';

/**
 * Minimal inline stroke icon set (1.6 weight) for the mobile nav system
 * (handoff spec "Assets": "a minimal inline stroke set (1.6 weight)").
 * The desktop app has no central icon library — icons are inlined per
 * component — so this is the mobile nav's local set. Each glyph is drawn
 * on a 24×24 viewBox with `currentColor` strokes so tab/app-bar colour
 * states cascade from the parent.
 */
export type NavIconName =
  | 'home'
  | 'patients'
  | 'report'
  | 'calendar'
  | 'settings'
  | 'profile'
  | 'users'
  | 'more'
  | 'search'
  | 'back'
  | 'close'
  | 'menu'
  | 'chevright'
  | 'chevdown'
  | 'help'
  | 'logout'
  | 'plus';

const PATHS: Record<NavIconName, ReactElement> = {
  // Day view / sun-over-horizon — the doctor's "Sot".
  home: (
    <>
      <circle cx="12" cy="13" r="3.4" />
      <path d="M12 4.5v2M4.8 13H3M21 13h-1.8M6.4 7.4 5.1 6.1M17.6 7.4l1.3-1.3M4 19h16" />
    </>
  ),
  patients: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M18 19a5 5 0 0 0-3-4.6" />
    </>
  ),
  // Daily report — document with a total line.
  report: (
    <>
      <path d="M6 3.5h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M13.5 3.5V8h4.2M8.5 13h7M8.5 16.5h7M8.5 9.5h2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  users: (
    <>
      <circle cx="8.5" cy="8.5" r="3" />
      <path d="M3 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.5M21 19a5 5 0 0 0-3.2-4.7" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  back: <path d="M14 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chevright: <path d="M9 5l7 7-7 7" />,
  chevdown: <path d="M6 9l6 6 6-6" />,
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9" />
      <path d="M12 17.2h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M14 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8" />
      <path d="M10 12h10M16.5 8.5 20 12l-3.5 3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

interface NavIconProps {
  name: NavIconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function NavIcon({
  name,
  size = 22,
  className,
  strokeWidth = 1.6,
}: NavIconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The teal EKG/pulse brand glyph used in the app bar + drawer header. */
export function BrandMark({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}): ReactElement {
  return (
    <span
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--teal-700, #0F766E)',
        color: '#fff',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ width: '58%', height: '58%' }}
      >
        <path d="M3 12h4l2-6 4 12 2-6h6" />
      </svg>
    </span>
  );
}
