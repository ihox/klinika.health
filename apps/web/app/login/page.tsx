import type { Metadata } from 'next';
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
      footer={
        <>
          <span>DonetaMED · Prizren</span>
          <span aria-hidden="true">·</span>
          <span>v1.0</span>
        </>
      }
    >
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
