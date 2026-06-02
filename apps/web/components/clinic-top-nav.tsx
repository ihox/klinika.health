'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { homePathForRoles, type AuthRole, type MeResponse } from '@/lib/auth-client';
import { grantedNavItems, isNavItemActive } from '@/lib/clinic-nav';
import { useBreakpoint } from '@/lib/hooks/use-breakpoint';
import { BrandLogo } from './brand-logo';
import { ClinicUserMenu } from './clinic-user-menu';
import { MobileClinicNav } from './mobile/mobile-clinic-nav';

/**
 * Adaptive clinic navigation (CLAUDE.md §5.8; mobile handoff §3).
 *
 * Renders two presentations, both driven by the SAME §5.8 role→menu model
 * (`grantedNavItems`) so the union a user sees never diverges across form
 * factors. The switch is a `useBreakpoint` conditional MOUNT (not CSS
 * hiding) so only one nav is ever in the DOM — no hidden duplicate links,
 * sheets, or user menus to collide with the rest of the app:
 *
 *   - **≥1280px (desktop):** the original horizontal top nav (markup
 *     unchanged → byte-identical desktop rendering). This is the SSR /
 *     pre-mount default, so desktop has no flash.
 *   - **<1280px (tablet + phone):** delegated to `MobileClinicNav`
 *     (enlarged tablet top nav / phone app bar + bottom tabs + sheets).
 *
 * Call sites are unchanged: every clinic page still renders a single
 * `<ClinicTopNav me={…} rightAdjacent={…} />`. `rightAdjacent` (the
 * doctor's GlobalPatientSearch) stays desktop-only; tablet/phone use the
 * search bottom sheet inside MobileClinicNav.
 */

interface Props {
  /**
   * The current user, as returned by `/api/auth/me`. Pass `null` during
   * the initial `useMe` fetch — the menu items collapse to nothing and the
   * user-menu slot renders an inert placeholder, so the layout reserves the
   * right amount of space and doesn't jump once the data lands.
   */
  me: MeResponse['user'] | null;
  /** Optional sibling rendered to the right of the brand (e.g. global search). */
  brandAdjacent?: React.ReactNode;
  /** Optional sibling rendered between the menu items and the user menu
   *  (e.g. the doctor's global patient search). Desktop-only. */
  rightAdjacent?: React.ReactNode;
}

export function ClinicTopNav({ me, brandAdjacent, rightAdjacent }: Props) {
  const pathname = usePathname() ?? '';
  const { isDesktop } = useBreakpoint();
  const roles = useMemo<AuthRole[]>(() => me?.roles ?? [], [me?.roles]);

  const items = useMemo(() => grantedNavItems(roles), [roles]);

  // Logo click target matches each role's post-login landing route
  // (homePathForRoles is the canonical priority — see auth-client.ts).
  const homePath = homePathForRoles(roles);

  // Below desktop → the adaptive mobile/tablet chrome (mounted only here,
  // so no desktop DOM contains it). `useBreakpoint` defaults to desktop
  // pre-mount, so desktop renders the header below with no flash.
  if (!isDesktop) {
    return <MobileClinicNav me={me} />;
  }

  return (
    <>
      {/* ── DESKTOP ≥1280px — original markup (byte-identical rendering) ── */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface-elevated">
        <div className="mx-auto flex max-w-page items-center justify-between px-page-x py-3">
          <div className="flex items-center gap-8">
            <Link href={homePath} className="flex items-center" aria-label="Klinika">
              <BrandLogo alt="" />
            </Link>
            {items.length > 0 ? (
              <nav className="flex items-center gap-5 text-[14px]" aria-label="Menu kryesore">
                {items.map((item) => {
                  const active = isNavItemActive(item, pathname);
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
            {rightAdjacent}
            {me ? (
              <ClinicUserMenu user={me} />
            ) : (
              // Pre-load placeholder — same 32×32 footprint as the rendered
              // avatar so the header doesn't jump when /me resolves.
              <div className="h-8 w-8 rounded-full bg-surface-subtle" aria-hidden="true" />
            )}
          </div>
        </div>
      </header>
    </>
  );
}
