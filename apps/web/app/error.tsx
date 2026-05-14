'use client';

import { useEffect } from 'react';

import { EmptyState } from '@/components/empty-state';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Global runtime error boundary. Catches uncaught errors thrown in
 * server or client components below the root layout and surfaces the
 * canonical "Lidhja u ndërpre" copy from
 * components/empty-states.html. Doctor's autosave keeps in-flight edits
 * in IndexedDB so the reassurance is accurate, not aspirational.
 */
export default function ErrorBoundary({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Surface the digest to the console so support can correlate with
    // server logs without exposing it in the UI.
    // eslint-disable-next-line no-console
    console.error('UI error', { digest: error.digest, message: error.message });
  }, [error]);

  return (
    <main className="min-h-screen bg-stone-50 grid place-items-center px-6 py-10">
      <EmptyState
        tall
        tone="amber"
        title="Lidhja u ndërpre"
        subtitle="Provoni përsëri pasi lidhja kthehet. Ndryshimet aktive janë të ruajtura lokalisht."
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
            <path d="M3 7c5-4 13-4 18 0" />
            <path d="M5.5 11c3.5-3 9.5-3 13 0" opacity="0.6" />
            <path d="M8 15c2-1.5 6-1.5 8 0" opacity="0.4" />
            <circle cx="12" cy="19" r="0.8" fill="currentColor" />
            <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        }
        actions={
          <button
            type="button"
            onClick={reset}
            className="rounded-md bg-teal-600 px-3.5 py-2 text-[13px] font-medium text-white shadow-xs hover:bg-teal-700"
          >
            Provo përsëri
          </button>
        }
      />
    </main>
  );
}
