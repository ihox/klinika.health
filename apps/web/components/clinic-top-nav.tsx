'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import type { AuthRole } from '@/lib/auth-client';

/**
 * Canonical role-to-menu mapping (CLAUDE.md §5.8, ADR-004 Multi-role
 * update). A user sees the UNION of items their roles grant; the
 * display order is fixed (Kalendari first, Cilësimet last) regardless
 * of which roles produced which items.
 *
 *   receptionist → Kalendari
 *   doctor       → Pamja e ditës + Pacientët
 *   clinic_admin → Cilësimet
 *
 * Paths target the existing Next.js routes per the routing answer in
 * the refactor brief (kept routes; nav uses Albanian labels). The
 * /pacientet wrapper does the role-aware dispatch for the literal
 * smoke-test URL.
 */

type NavRole = Extract<AuthRole, 'doctor' | 'receptionist' | 'clinic_admin'>;

interface NavItem {
  key: string;
  label: string;
  path: string;
  /** Sub-paths under which this item should still light up.
   *  e.g. /pacient/[id] is "still on Pacientët". */
  activePrefixes: string[];
  /** Roles that grant this menu item. OR semantics. */
  grantedBy: NavRole[];
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'kalendari',
    label: 'Kalendari',
    path: '/receptionist',
    activePrefixes: ['/receptionist'],
    grantedBy: ['receptionist'],
  },
  {
    key: 'pamja-e-dites',
    label: 'Pamja e ditës',
    path: '/doctor',
    activePrefixes: ['/doctor'],
    grantedBy: ['doctor'],
  },
  {
    key: 'pacientet',
    label: 'Pacientët',
    path: '/pacientet',
    // /pacientet is the role-aware wrapper; /pacient/[id] is the
    // chart view; /doctor/pacientet is where the wrapper redirects.
    // All three should light up "Pacientët".
    activePrefixes: ['/pacientet', '/pacient', '/doctor/pacientet'],
    grantedBy: ['doctor'],
  },
  {
    key: 'cilesimet',
    label: 'Cilësimet',
    path: '/cilesimet',
    activePrefixes: ['/cilesimet'],
    grantedBy: ['clinic_admin'],
  },
];

interface Props {
  roles: AuthRole[];
  /**
   * Right-aligned slot — used by the user menu in STEP 5 once the
   * dropdown lands. Falls back to a simple `Profili im →` link so
   * the nav still works without the menu.
   */
  trailing?: React.ReactNode;
  /** Optional sibling rendered to the right of the brand (e.g. global search). */
  brandAdjacent?: React.ReactNode;
}

export function ClinicTopNav({ roles, trailing, brandAdjacent }: Props) {
  const pathname = usePathname() ?? '';

  const items = useMemo(() => {
    return NAV_ITEMS.filter((item) => item.grantedBy.some((r) => roles.includes(r)));
  }, [roles]);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface-elevated">
      <div className="mx-auto flex max-w-page items-center justify-between px-page-x py-3">
        <div className="flex items-center gap-8">
          <Link
            href="/profili-im"
            className="font-display text-[17px] font-semibold tracking-[-0.015em] text-ink-strong"
            aria-label="Klinika"
          >
            klinika<span className="text-primary">.</span>
          </Link>
          {items.length > 0 ? (
            <nav className="flex items-center gap-5 text-[14px]" aria-label="Menu kryesore">
              {items.map((item) => {
                const active = item.activePrefixes.some(
                  (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
                );
                return (
                  <Link
                    key={item.key}
                    href={item.path}
                    className={
                      active ? 'font-medium text-ink-strong' : 'text-ink-muted hover:text-ink'
                    }
                    aria-current={active ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          ) : null}
          {brandAdjacent ? <div className="flex items-center">{brandAdjacent}</div> : null}
        </div>
        <div className="flex items-center gap-4">
          {trailing ?? (
            <Link href="/profili-im" className="text-[13px] text-ink-muted hover:text-ink">
              Profili im →
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
