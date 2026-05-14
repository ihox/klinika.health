import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RouteGate } from '@/components/route-gate';

import { ClinicSettingsView } from './clinic-settings-view';

export const metadata: Metadata = {
  title: 'Cilësimet · Klinika',
};

// The view reads `useSearchParams()` for tab deep-links, so it must
// render under a Suspense boundary on App Router (CSR bailout). The
// RouteGate guards the surface — only callers with the clinic_admin
// role land here; everyone else gets the /forbidden empty state.
export default function ClinicSettingsPage() {
  return (
    <RouteGate required={['clinic_admin']}>
      <Suspense
        fallback={
          <main className="min-h-screen bg-stone-50 grid place-items-center text-stone-500">
            Po ngarkohet…
          </main>
        }
      >
        <ClinicSettingsView />
      </Suspense>
    </RouteGate>
  );
}
