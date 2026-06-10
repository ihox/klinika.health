import type { AuthRole } from './auth-client';
import type { NavIconName } from '@/components/mobile/nav-icon';

/**
 * Canonical clinic navigation model — the single source of truth shared by
 * the desktop top nav, the tablet enlarged top nav, and the phone bottom
 * tab bar / overflow sheet (CLAUDE.md §5.8, ADR-004 multi-role; Raporti
 * per ADR-019).
 *
 * A user sees the UNION of items their roles grant; the display order is
 * fixed regardless of which roles produced which items. Deriving mobile
 * tabs from this same table keeps mobile, desktop, and the RLS boundary
 * in lockstep — the mobile UI never introduces a destination the desktop
 * nav (and §5.8) doesn't already grant.
 */
export type NavRole = Extract<AuthRole, 'doctor' | 'receptionist' | 'clinic_admin'>;

export interface NavItem {
  key: string;
  /** Full label — desktop + tablet top nav, overflow sheet, app-bar title. */
  label: string;
  /** Short label for the cramped phone bottom-tab bar (handoff §3: the
   *  doctor's "Pamja e ditës" reads "Sot" as a tab). Defaults to `label`. */
  tabLabel: string;
  path: string;
  /** Sub-paths under which this item should still light up (e.g.
   *  /pacient/[id] is "still on Pacientët"). */
  activePrefixes: string[];
  /** Roles that grant this menu item. OR semantics. */
  grantedBy: NavRole[];
  /** Icon for the mobile bottom-tab bar + overflow sheet. */
  icon: NavIconName;
}

export const NAV_ITEMS: NavItem[] = [
  {
    key: 'kalendari',
    label: 'Kalendari',
    tabLabel: 'Kalendari',
    path: '/receptionist',
    activePrefixes: ['/receptionist'],
    grantedBy: ['receptionist'],
    icon: 'calendar',
  },
  {
    key: 'pamja-e-dites',
    label: 'Pamja e ditës',
    tabLabel: 'Sot',
    path: '/doctor',
    activePrefixes: ['/doctor'],
    grantedBy: ['doctor'],
    icon: 'home',
  },
  {
    key: 'pacientet',
    label: 'Pacientët',
    tabLabel: 'Pacientët',
    path: '/pacientet',
    // /pacientet is the role-aware wrapper; /pacient/[id] is the chart
    // view; /doctor/pacientet is where the wrapper redirects. All three
    // light up "Pacientët".
    activePrefixes: ['/pacientet', '/pacient', '/doctor/pacientet'],
    grantedBy: ['doctor'],
    icon: 'patients',
  },
  {
    key: 'raporti',
    label: 'Raporti',
    tabLabel: 'Raporti',
    path: '/raporti',
    activePrefixes: ['/raporti'],
    grantedBy: ['doctor', 'receptionist', 'clinic_admin'],
    icon: 'report',
  },
  {
    key: 'cilesimet',
    label: 'Cilësimet',
    tabLabel: 'Cilësimet',
    path: '/cilesimet',
    activePrefixes: ['/cilesimet'],
    grantedBy: ['clinic_admin'],
    icon: 'settings',
  },
];

/** The label shown in the phone app bar for the profile surface. */
export const PROFILE_PATH = '/profili-im';

/** Items granted to the given roles, in canonical display order. */
export function grantedNavItems(roles: readonly AuthRole[]): NavItem[] {
  return NAV_ITEMS.filter((item) => item.grantedBy.some((r) => roles.includes(r as AuthRole)));
}

/** Is `pathname` within the active scope of `item`? Matches the desktop
 *  nav's exact-or-prefix rule so the active highlight is identical across
 *  all three nav presentations. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Split the granted items into the phone bottom-tab primaries (max 3) and
 * the overflow that lives behind "Më shumë". The overflow always carries
 * the account actions (profile + logout) appended by the nav component;
 * this returns only the nav-item portion.
 */
export function splitBottomTabs(items: NavItem[]): {
  primary: NavItem[];
  overflow: NavItem[];
} {
  const PRIMARY_MAX = 3;
  if (items.length <= PRIMARY_MAX) {
    return { primary: items, overflow: [] };
  }
  return {
    primary: items.slice(0, PRIMARY_MAX),
    overflow: items.slice(PRIMARY_MAX),
  };
}

/** App-bar title for the current path: the active nav item's label, or
 *  "Profili im" on the profile route, else the brand fallback. */
export function appBarTitle(items: NavItem[], pathname: string): string {
  if (pathname === PROFILE_PATH || pathname.startsWith(`${PROFILE_PATH}/`)) {
    return 'Profili im';
  }
  const active = items.find((item) => isNavItemActive(item, pathname));
  return active?.label ?? 'Klinika';
}
