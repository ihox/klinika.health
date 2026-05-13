import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminLoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Hyrja · Platform Admin',
};

export default function AdminLoginPage() {
  return (
    <main className="min-h-screen bg-stone-50 grid place-items-center px-6 py-10">
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-teal-700 via-teal-500 to-teal-700 z-50"
      />
      <Suspense fallback={<div className="text-stone-500 text-sm">Po ngarkohet…</div>}>
        <AdminLoginForm />
      </Suspense>
    </main>
  );
}
