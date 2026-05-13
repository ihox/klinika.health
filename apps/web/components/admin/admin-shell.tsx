'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ApiError } from '@/lib/api';
import { adminClient, type AdminProfile } from '@/lib/admin-client';
import { BrandRow } from '@/components/auth/brand-row';

interface AdminShellProps {
  children: React.ReactNode;
}

interface NavItem {
  href: string;
  label: string;
  matchPrefix: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: 'Klinikat', matchPrefix: '/admin' },
  { href: '/admin/health', label: 'Sistemi', matchPrefix: '/admin/health' },
  { href: '/admin/platform-admins', label: 'Administratorët', matchPrefix: '/admin/platform-admins' },
];

/**
 * Shared chrome for every `/admin/*` page. Pulls the admin profile
 * via `/api/admin/auth/me`; a 401 redirects to `/admin/login` so the
 * deep-link survives a fresh browser session.
 *
 * The identity stripe at the top is a deliberate visual signal that
 * the user is on the platform-admin surface (not a clinic). Same hue
 * as the primary, just unmistakable.
 */
export function AdminShell({ children }: AdminShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await adminClient.me();
        if (!cancelled) {
          setAdmin(out.admin);
          setLoading(false);
        }
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          // Carry the current path so we can return after login.
          const redirect = encodeURIComponent(pathname ?? '/admin');
          router.replace(`/admin/login?redirect=${redirect}`);
          return;
        }
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, pathname]);

  const handleLogout = async () => {
    try {
      await adminClient.logout();
    } finally {
      router.replace('/admin/login');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50">
        <IdentityStripe />
        <div className="pt-10 text-center text-stone-500 text-sm">Po ngarkohet…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <IdentityStripe />
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-[1200px] mx-auto px-8 h-14 flex items-center gap-8">
          <Link href="/admin" className="flex items-center gap-2.5">
            <BrandRow size={22} />
            <span
              className="text-[10.5px] font-semibold uppercase tracking-wider text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full"
              aria-label="Platform Admin"
            >
              Platform Admin
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active =
                item.href === '/admin'
                  ? pathname === '/admin' || pathname?.startsWith('/admin/tenants') === true
                  : pathname?.startsWith(item.matchPrefix) === true;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                    active
                      ? 'text-stone-900 bg-stone-100'
                      : 'text-stone-500 hover:text-stone-800 hover:bg-stone-50'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex-1" />
          {admin ? (
            <div className="flex items-center gap-3">
              <div className="flex flex-col items-end leading-tight">
                <span className="text-[13px] font-medium text-stone-900">
                  {admin.firstName} {admin.lastName}
                </span>
                <span className="text-[11px] text-stone-500">Platform Admin</span>
              </div>
              <button
                onClick={handleLogout}
                className="text-[13px] text-stone-500 hover:text-teal-700 hover:underline"
                type="button"
              >
                Dil
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <main className="max-w-[1200px] mx-auto px-8 py-8">{children}</main>
    </div>
  );
}

function IdentityStripe() {
  return (
    <div
      aria-hidden="true"
      className="h-[3px] w-full bg-gradient-to-r from-teal-700 via-teal-500 to-teal-700"
    />
  );
}
