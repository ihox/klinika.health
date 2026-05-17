import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Suspense } from 'react';

import { AuthShell } from '@/components/auth/auth-shell';
import { AuthFooter } from '@/components/auth/auth-footer';
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
  return <ClinicLoginPage clinicName={identity?.name ?? null} />;
}

function PlatformLoginPage() {
  return (
    <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
      <PlatformAdminLoginForm />
    </Suspense>
  );
}

function ClinicLoginPage({ clinicName }: { clinicName: string | null }) {
  return (
    <AuthShell
      title="Mirë se erdhët"
      subtitle="Hyni në llogarinë tuaj për të vazhduar."
      footer={<AuthFooter left={clinicName ?? 'Klinika'} />}
    >
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}

