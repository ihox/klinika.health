'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { AdminProfile } from '@/lib/admin-client';

/**
 * Avatar + dropdown menu in the top-right of the platform admin
 * shell (components/user-menu.html — "Administrator i platformës"
 * section). Visual treatment differs from the clinic menu: slate
 * avatar (instead of role-coloured), stacked name + role-tag in the
 * trigger, and a `.um-head` with name + role text (not email + role
 * chips).
 *
 * Menu items are minimal for now — only Dilni. The design also
 * sketches Profili im / Shkurtoret e tastierës / Ndihmë &
 * mbështetje but those routes don't exist yet; adding placeholder
 * links would be dead UI.
 */

interface Props {
  admin: Pick<AdminProfile, 'firstName' | 'lastName'>;
  onLogout: () => void | Promise<void>;
}

export function PlatformAdminUserMenu({ admin, onLogout }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const displayName = `${admin.firstName} ${admin.lastName}`;
  const initials = `${admin.firstName.charAt(0)}${admin.lastName.charAt(0)}`.toUpperCase();

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

  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>('[data-menu-item]');
    first?.focus();
  }, [open]);

  const handleLogout = useCallback(async () => {
    await onLogout();
  }, [onLogout]);

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
        className="inline-flex items-center gap-2 rounded-md py-1 pl-1 pr-2 outline-none transition-colors hover:bg-stone-100 focus-visible:ring-2 focus-visible:ring-teal-500/40"
      >
        <span
          className="grid h-7 w-7 place-items-center rounded-full bg-ink-strong text-[11px] font-semibold text-white"
          aria-hidden="true"
        >
          {initials}
        </span>
        <span className="hidden flex-col items-start leading-tight md:flex">
          <span className="text-[13px] font-medium text-ink">{displayName}</span>
          <span className="mt-px font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink-faint">
            Platform Admin
          </span>
        </span>
        <span aria-hidden="true" className="hidden text-[10px] leading-none text-ink-faint md:inline">
          ▾
        </span>
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-orientation="vertical"
          className="absolute right-0 top-[calc(100%+6px)] z-40 w-[232px] overflow-hidden rounded-md border border-line bg-surface-elevated shadow-modal animate-fade-in"
        >
          <div className="border-b border-line-soft bg-surface-subtle px-3.5 py-3">
            <div className="font-display text-[13.5px] font-semibold leading-tight text-ink-strong">
              {displayName}
            </div>
            <div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
              Platform admin · Klinika.health
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            data-menu-item
            onClick={() => void handleLogout()}
            className="flex w-full items-center gap-2.5 px-3.5 py-[9px] text-left text-[13px] text-danger outline-none hover:bg-danger-bg focus-visible:bg-danger-bg"
          >
            <LogoutIcon />
            Dilni
          </button>
        </div>
      ) : null}
    </div>
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
