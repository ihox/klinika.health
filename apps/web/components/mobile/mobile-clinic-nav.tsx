'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { authClient, homePathForRoles, type MeResponse } from '@/lib/auth-client';
import {
  appBarTitle,
  grantedNavItems,
  isNavItemActive,
  PROFILE_PATH,
  splitBottomTabs,
} from '@/lib/clinic-nav';
import { cn } from '@/lib/utils';
import { ClinicUserMenu } from '@/components/clinic-user-menu';
import { BottomSheet } from './bottom-sheet';
import { BrandMark, NavIcon } from './nav-icon';
import { PatientSearchSheet } from './patient-search-sheet';

interface Props {
  me: MeResponse['user'] | null;
}

/**
 * Mobile + tablet navigation chrome (handoff spec §3). Renders three
 * breakpoint-gated presentations via CSS so there is no hydration flash
 * and the desktop (≥1280px) nav in ClinicTopNav stays the sole nav there:
 *
 *   - tablet 768–1279px → enlarged top nav (64px, ≥44px targets), no bottom bar
 *   - phone <768px      → sticky top app bar + fixed bottom tab bar + sheets
 *
 * Nav items are derived from the shared §5.8 model (`grantedNavItems`) so
 * the union a user sees is identical to desktop. Search opens the shared
 * bottom sheet; ⌘K opens it too (below desktop only — desktop keeps its
 * own GlobalPatientSearch ⌘K).
 */
export function MobileClinicNav({ me }: Props) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const roles = useMemo(() => me?.roles ?? [], [me?.roles]);

  const items = useMemo(() => grantedNavItems(roles), [roles]);
  const { primary, overflow } = useMemo(() => splitBottomTabs(items), [items]);
  const homePath = homePathForRoles(roles);
  const title = appBarTitle(items, pathname);

  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Reserve room for the fixed phone tab bar (mobile.css scopes the inset
  // to phone widths). Set while this nav is mounted; cleared on unmount so
  // auth/error pages without a clinic nav don't get the inset.
  useEffect(() => {
    document.body.dataset.mobileNav = 'tabs';
    return () => {
      delete document.body.dataset.mobileNav;
    };
  }, []);

  // ⌘K / Ctrl+K opens the search sheet below desktop. At ≥1280px the
  // desktop GlobalPatientSearch owns the chord, so this no-ops there.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'k') return;
      if (typeof window !== 'undefined' && window.innerWidth >= 1280) return;
      e.preventDefault();
      setSearchOpen(true);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const moreActive =
    (pathname === PROFILE_PATH || pathname.startsWith(`${PROFILE_PATH}/`)) ||
    overflow.some((item) => isNavItemActive(item, pathname));

  return (
    <>
      {/* ── TABLET 768–1279: enlarged top nav ─────────────────────────── */}
      <header className="sticky top-0 z-30 hidden h-16 items-center gap-5 border-b border-line bg-surface-elevated/90 px-[var(--m-gutter-lg)] backdrop-blur-md backdrop-saturate-150 md:flex xl:hidden">
        <Link href={homePath} aria-label="Klinika" className="flex shrink-0 items-center gap-2.5">
          <BrandMark size={30} />
          <span className="font-display text-[18px] font-semibold tracking-[-0.02em] text-ink-strong">
            klinika<span className="font-normal text-ink-faint">.health</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Menu kryesore">
          {items.map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <Link
                key={item.key}
                href={item.path}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex min-h-[44px] items-center rounded-md px-4 text-[15px] font-medium transition',
                  active
                    ? 'text-ink-strong after:absolute after:inset-x-4 after:-bottom-px after:h-[2.5px] after:rounded after:bg-primary'
                    : 'text-ink-muted hover:bg-surface-subtle hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          className="flex min-h-[44px] w-[220px] items-center gap-2 rounded-md bg-surface-subtle px-3.5 text-[14px] text-ink-faint transition hover:bg-surface-muted"
        >
          <NavIcon name="search" size={16} />
          <span>Kërko pacient</span>
          <kbd className="ml-auto rounded border border-line bg-surface-elevated px-1.5 py-0.5 font-mono text-[11px] text-ink-faint">
            ⌘K
          </kbd>
        </button>
        {me ? (
          <ClinicUserMenu user={me} />
        ) : (
          <div className="h-8 w-8 rounded-full bg-surface-subtle" aria-hidden />
        )}
      </header>

      {/* ── PHONE <768: sticky top app bar ────────────────────────────── */}
      <header
        className="sticky top-0 z-30 flex items-center gap-[var(--m-s3)] border-b border-line bg-surface-elevated/90 px-[var(--m-gutter)] backdrop-blur-md backdrop-saturate-150 md:hidden"
        style={{
          paddingTop: 'env(safe-area-inset-top, 0px)',
          minHeight: 'calc(var(--m-appbar-h) + env(safe-area-inset-top, 0px))',
        }}
      >
        <Link href={homePath} aria-label="Klinika" className="flex shrink-0 items-center">
          <BrandMark size={30} />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[18px] font-semibold tracking-[-0.02em] text-ink-strong">
            {title}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSearchOpen(true)}
          aria-label="Kërko"
          className="grid h-11 w-11 place-items-center rounded-full text-ink-muted transition active:bg-surface-muted [-webkit-tap-highlight-color:transparent]"
        >
          <NavIcon name="search" size={22} />
        </button>
        {me ? (
          <ClinicUserMenu user={me} />
        ) : (
          <div className="h-8 w-8 rounded-full bg-surface-subtle" aria-hidden />
        )}
      </header>

      {/* ── PHONE <768: fixed bottom tab bar ──────────────────────────── */}
      <nav
        aria-label="Navigimi kryesor"
        data-mobile-tabbar=""
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line bg-surface-elevated/95 backdrop-blur-md backdrop-saturate-150 md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {primary.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <Link
              key={item.key}
              href={item.path}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex min-h-[var(--m-tabbar-h)] flex-1 flex-col items-center justify-center gap-[3px] py-2 [-webkit-tap-highlight-color:transparent]',
                active ? 'text-primary-dark' : 'text-ink-faint active:text-ink',
              )}
            >
              <NavIcon name={item.icon} size={24} strokeWidth={active ? 1.9 : 1.6} />
              <span className={cn('text-[10.5px] tracking-[-0.01em]', active && 'font-semibold')}>
                {item.tabLabel}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            'flex min-h-[var(--m-tabbar-h)] flex-1 flex-col items-center justify-center gap-[3px] py-2 [-webkit-tap-highlight-color:transparent]',
            moreActive ? 'text-primary-dark' : 'text-ink-faint active:text-ink',
          )}
        >
          <NavIcon name="more" size={24} strokeWidth={moreActive ? 1.9 : 1.6} />
          <span className={cn('text-[10.5px] tracking-[-0.01em]', moreActive && 'font-semibold')}>
            Më shumë
          </span>
        </button>
      </nav>

      {/* ── Shared sheets ─────────────────────────────────────────────── */}
      <PatientSearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} roles={roles} />
      <MoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        overflow={overflow}
        pathname={pathname}
        onNavigate={(path) => {
          setMoreOpen(false);
          router.push(path);
        }}
      />
    </>
  );
}

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  overflow: ReturnType<typeof grantedNavItems>;
  pathname: string;
  onNavigate: (path: string) => void;
}

/** The "Më shumë" overflow sheet — any nav items beyond the 3 primary
 *  tabs, plus the account actions (profile + logout). */
function MoreSheet({ open, onClose, overflow, pathname, onNavigate }: MoreSheetProps) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authClient.logout();
    } catch {
      // Sign-out is best-effort; route to login regardless.
    } finally {
      router.replace('/login');
    }
  }, [loggingOut, router]);

  const profileActive =
    pathname === PROFILE_PATH || pathname.startsWith(`${PROFILE_PATH}/`);

  return (
    <BottomSheet open={open} onClose={onClose} title="Më shumë" data-testid="mobile-more-sheet">
      <ul className="pb-2">
        {overflow.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => onNavigate(item.path)}
                className={cn(
                  'flex min-h-[52px] w-full items-center gap-3.5 px-[var(--m-gutter)] text-left text-[15px] transition active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]',
                  active ? 'font-semibold text-primary-dark' : 'text-ink',
                )}
              >
                <span className={cn('grid h-6 w-6 place-items-center', active ? 'text-primary' : 'text-ink-muted')}>
                  <NavIcon name={item.icon} size={22} />
                </span>
                <span className="flex-1">{item.label}</span>
                <NavIcon name="chevright" size={16} className="text-ink-faint" />
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => onNavigate(PROFILE_PATH)}
            className={cn(
              'flex min-h-[52px] w-full items-center gap-3.5 px-[var(--m-gutter)] text-left text-[15px] transition active:bg-surface-subtle [-webkit-tap-highlight-color:transparent]',
              profileActive ? 'font-semibold text-primary-dark' : 'text-ink',
            )}
          >
            <span className={cn('grid h-6 w-6 place-items-center', profileActive ? 'text-primary' : 'text-ink-muted')}>
              <NavIcon name="profile" size={22} />
            </span>
            <span className="flex-1">Profili im</span>
            <NavIcon name="chevright" size={16} className="text-ink-faint" />
          </button>
        </li>
        <li>
          <div className="my-1 h-px bg-line-soft" aria-hidden />
        </li>
        <li>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={loggingOut}
            className="flex min-h-[52px] w-full items-center gap-3.5 px-[var(--m-gutter)] text-left text-[15px] text-danger transition active:bg-danger-bg disabled:opacity-60 [-webkit-tap-highlight-color:transparent]"
          >
            <span className="grid h-6 w-6 place-items-center text-danger">
              <NavIcon name="logout" size={22} />
            </span>
            <span className="flex-1">{loggingOut ? 'Po dilet…' : 'Dilni'}</span>
          </button>
        </li>
      </ul>
    </BottomSheet>
  );
}
