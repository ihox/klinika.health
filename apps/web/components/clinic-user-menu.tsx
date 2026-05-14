'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { authClient, type AuthRole } from '@/lib/auth-client';
import { type ClinicRole, orderRoles } from '@/lib/role-labels';
import { RoleChip } from './role-chip';

/**
 * Avatar + dropdown menu in the top-right of the clinic shell
 * (components/user-menu.html). Renders the user's initials in a
 * colour derived from their primary role, opens to a panel that
 * shows name + email + role chips + Profili im + Dilni.
 *
 * Behaviour:
 *   - Click avatar toggles. Click-outside closes. Escape closes.
 *   - Arrow Up/Down cycles the focusable items inside the panel.
 *   - Enter / Space on the avatar opens; Enter on a focused item
 *     activates the default action (the underlying link/button
 *     handles it).
 *
 * Logout calls `/api/auth/logout` then routes back to `/login`. The
 * router push keeps the session-expired reason out of the URL — this
 * is a deliberate sign-out, not an interrupted one.
 */

interface UserSummary {
  firstName: string;
  lastName: string;
  email: string;
  title: string | null;
  roles: AuthRole[];
}

interface Props {
  user: UserSummary;
}

export function ClinicUserMenu({ user }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const clinicRoles = useMemo(
    () =>
      orderRoles(user.roles).filter(
        (r): r is ClinicRole => r === 'doctor' || r === 'receptionist' || r === 'clinic_admin',
      ),
    [user.roles],
  );

  // Avatar colour follows the dominant role — doctor > admin >
  // receptionist > stone (fallback).
  const avatarBg = user.roles.includes('doctor')
    ? 'bg-indigo-700'
    : user.roles.includes('clinic_admin')
      ? 'bg-slate-700'
      : user.roles.includes('receptionist')
        ? 'bg-violet-700'
        : 'bg-teal-700';

  const initials = `${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase();
  const displayName = `${user.title ? `${user.title} ` : ''}${user.firstName} ${user.lastName}`;

  // Click outside.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  // Escape closes; arrow keys move focus across items inside the
  // panel. We re-query items each keypress so layout changes (e.g.
  // showing a "sign-out failed" line) don't break the cycle.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [],
      );
      if (items.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const currentIndex = active ? items.indexOf(active) : -1;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = (currentIndex + delta + items.length) % items.length;
      items[next]?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // When the panel opens, move focus to its first item.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>('[data-menu-item]');
    first?.focus();
  }, [open]);

  const handleLogout = useCallback(async () => {
    try {
      await authClient.logout();
    } finally {
      router.replace('/login');
    }
  }, [router]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Menyja e përdoruesit · ${displayName}`}
        className={[
          'grid h-8 w-8 place-items-center rounded-full text-[12px] font-semibold text-white',
          'outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
          avatarBg,
        ].join(' ')}
      >
        {initials}
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-[232px] overflow-hidden rounded-md border border-line bg-surface-elevated shadow-modal animate-fade-in"
        >
          <div className="border-b border-line bg-surface-subtle px-3.5 py-3">
            <div className="font-display text-[13.5px] font-semibold leading-tight text-ink-strong">
              {displayName}
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-ink-muted">
              {user.email}
            </div>
            {clinicRoles.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {clinicRoles.map((r) => (
                  <RoleChip key={r} role={r} />
                ))}
              </div>
            ) : null}
          </div>
          <a
            href="/profili-im"
            role="menuitem"
            data-menu-item
            className="flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-ink outline-none hover:bg-surface-subtle focus-visible:bg-surface-subtle"
          >
            <ProfileIcon />
            Profili im
          </a>
          <div className="h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            data-menu-item
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] text-danger outline-none hover:bg-danger-bg focus-visible:bg-danger-bg"
          >
            <LogoutIcon />
            Dilni
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ProfileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-ink-muted"
      aria-hidden="true"
    >
      <circle cx="8" cy="5.5" r="2.8" />
      <path d="M2.5 14c0-3 2.5-4.5 5.5-4.5s5.5 1.5 5.5 4.5" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4V2.5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V12" />
      <path d="M6.5 8h8M11.5 5l3 3-3 3" />
    </svg>
  );
}
