import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { CenteredAuthShell } from '@/components/auth/centered-auth-shell';
import { PlatformAdminLoginForm } from '@/components/auth/platform-admin-login-form';

import { LoginForm } from './login-form';

interface ClinicIdentity {
  subdomain: string;
  name: string;
  shortName: string;
}

async function fetchClinicIdentity(host: string): Promise<ClinicIdentity | null> {
  // Server-to-server call to /api/auth/clinic-identity. We pass the
  // resolved Host header straight through so the API middleware sees
  // the same scope the web middleware did — the source of truth for
  // the boundary is shared, not duplicated.
  const apiBase = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';
  try {
    const res = await fetch(`${apiBase}/api/auth/clinic-identity`, {
      headers: { host, 'x-forwarded-host': host },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ClinicIdentity;
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const scope = h.get('x-klinika-scope');
  if (scope === 'platform') {
    return { title: 'Hyrja · Admini i Platformës — Klinika' };
  }
  const subdomain = h.get('x-klinika-subdomain');
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  if (subdomain) {
    const identity = await fetchClinicIdentity(host);
    if (identity) {
      return { title: `Hyrja · ${identity.name} — Klinika` };
    }
  }
  return { title: 'Hyrja · Klinika' };
}

export default async function LoginPage() {
  const h = await headers();
  const scope = h.get('x-klinika-scope');

  if (scope === 'platform') {
    return <PlatformLoginPage />;
  }

  const host = h.get('x-forwarded-host') ?? h.get('host') ?? '';
  const identity = await fetchClinicIdentity(host);
  // If the API can't resolve the clinic identity, the middleware
  // already would have rejected — but we render a fallback so a
  // misconfigured env doesn't leave the page blank.
  return <ClinicLoginPage identity={identity} />;
}

function PlatformLoginPage() {
  return (
    <CenteredAuthShell>
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <PlatformAdminLoginForm />
      </Suspense>
    </CenteredAuthShell>
  );
}

function ClinicLoginPage({ identity }: { identity: ClinicIdentity | null }) {
  return (
    <AuthShell
      title="Mirë se erdhët"
      subtitle="Hyni në llogarinë tuaj për të vazhduar."
      header={<ClinicIdentityCard identity={identity} />}
      footer={
        <div className="flex w-full items-center justify-between">
          <Link href="/" className="text-stone-500 hover:text-teal-700">
            ← klinika.health
          </Link>
          <div className="flex items-center gap-1.5 text-stone-500">
            <ShieldIcon />
            <span>Mbrojtur me MFA</span>
          </div>
        </div>
      }
    >
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

/**
 * Clinic identity card shown above the login title. Mirrors the
 * components/clinic-login.html reference: 44px logo placeholder,
 * clinic name, descriptor + subdomain. Driven by the resolved clinic
 * identity from `/api/auth/clinic-identity` rather than any hardcoded
 * tenant data — per CLAUDE.md §6, no clinic-specific content in the
 * bundle.
 */
function ClinicIdentityCard({ identity }: { identity: ClinicIdentity | null }) {
  const shortName = identity?.shortName ?? '';
  const name = identity?.name ?? 'Klinika';
  const subdomain = identity?.subdomain ?? '';
  const initials = shortName.slice(0, 2).toUpperCase() || name.slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-stone-200 bg-white px-4 py-3.5 shadow-xs">
      <div
        aria-hidden="true"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-teal-200 bg-teal-100 font-display text-[17px] font-bold tracking-tight text-teal-800"
      >
        {initials}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="font-display text-[15px] font-semibold tracking-tighter text-stone-900">
          {name}
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-stone-500">
          <span>Ambulanca Pediatrike</span>
          {subdomain ? (
            <>
              <span className="text-stone-300">·</span>
              <code className="font-mono text-[11px] text-stone-400">{subdomain}.klinika.health</code>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="text-teal-600"
      aria-hidden="true"
    >
      <path d="M8 2L3 4v4c0 3 2.5 5.5 5 6.5 2.5-1 5-3.5 5-6.5V4L8 2z" />
    </svg>
  );
}
