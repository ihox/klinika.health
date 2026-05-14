import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ClinicSettingsView } from './clinic-settings-view';

export const metadata: Metadata = {
  title: 'Cilësimet · Klinika',
};

// The view reads `useSearchParams()` for tab deep-links, so it must
// render under a Suspense boundary on App Router (CSR bailout).
export default function ClinicSettingsPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-stone-50 grid place-items-center text-stone-500">
          Po ngarkohet…
        </main>
      }
    >
      <ClinicSettingsView />
    </Suspense>
  );
}
