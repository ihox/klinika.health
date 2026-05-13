import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from './reset-form';
import { AuthShell } from '@/components/auth/auth-shell';

export const metadata: Metadata = {
  title: 'Rivendos fjalëkalimin · Klinika',
  description: 'Vendosni një fjalëkalim të ri',
};

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Vendos fjalëkalim të ri" subtitle="Të paktën 10 karaktere.">
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
