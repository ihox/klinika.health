import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';

export const metadata: Metadata = {
  title: 'Faqja nuk u gjet · Klinika',
};

export default function NotFound() {
  return (
    <main className="min-h-screen bg-stone-50 grid place-items-center px-6 py-10">
      <EmptyState
        tall
        code="Gabim 404"
        title="Faqja nuk u gjet"
        subtitle="Linku mund të jetë i vjetëruar ose faqja është zhvendosur."
        icon={
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16l5 5" />
          </svg>
        }
        actions={
          <Link
            href="/"
            className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-xs hover:bg-teal-700"
          >
            Kthehu te fillimi
          </Link>
        }
      />
    </main>
  );
}
