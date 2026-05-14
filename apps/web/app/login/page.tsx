import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from './login-form';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata: Metadata = {
  title: 'Hyrja · Klinika',
  description: 'Hyni në Klinika',
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Mirë se erdhët"
      subtitle="Hyni në llogarinë tuaj për të vazhduar."
      header={<ClinicIdentityCard />}
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
 * components/clinic-login.html reference: 44px logo placeholder, clinic
 * name, descriptor + subdomain. Hardcoded for the v1 single-tenant
 * install (DonetaMED), consistent with the existing auth-shell hero copy.
 */
function ClinicIdentityCard() {
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-stone-200 bg-white px-4 py-3.5 shadow-xs">
      <div
        aria-hidden="true"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-teal-200 bg-teal-100 font-display text-[17px] font-bold tracking-tight text-teal-800"
      >
        DM
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="font-display text-[15px] font-semibold tracking-tighter text-stone-900">
          DonetaMED
        </div>
        <div className="flex items-center gap-1.5 text-[12px] text-stone-500">
          <span>Ambulanca Pediatrike</span>
          <span className="text-stone-300">·</span>
          <code className="font-mono text-[11px] text-stone-400">donetamed.klinika.health</code>
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
