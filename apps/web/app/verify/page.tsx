import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyForm } from './verify-form';
import { CenteredAuthShell } from '@/components/auth/centered-auth-shell';

export const metadata: Metadata = {
  title: 'Verifikoni se jeni ju · Klinika',
  description: 'Verifikoni kodin për të vazhduar',
};

export default function VerifyPage() {
  return (
    <CenteredAuthShell>
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <VerifyForm />
      </Suspense>
    </CenteredAuthShell>
  );
}
