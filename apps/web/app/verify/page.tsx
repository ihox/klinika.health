import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyForm } from './verify-form';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata: Metadata = {
  title: 'Verifikoni se jeni ju · Klinika',
  description: 'Verifikoni kodin për të vazhduar',
};

export default function VerifyPage() {
  return (
    <AuthShell title="Verifikoni se jeni ju">
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <VerifyForm />
      </Suspense>
    </AuthShell>
  );
}
