import type { Metadata } from 'next';

import { EmptyState } from '@/components/empty-state';
import { BackButton } from './back-button';

export const metadata: Metadata = {
  title: 'Pa qasje · Klinika',
};

export default function ForbiddenPage() {
  return (
    <main className="min-h-screen bg-stone-50 grid place-items-center px-6 py-10">
      <EmptyState
        tall
        tone="amber"
        code="Gabim 403"
        title="Ju nuk keni qasje në këtë seksion"
        subtitle="Kontaktoni admin-in e klinikës nëse ju duhet qasje."
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5" y="10" width="14" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
        }
        actions={<BackButton />}
      />
    </main>
  );
}
