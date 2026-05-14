import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RouteGate } from '@/components/route-gate';

import { DoctorPatientsView } from './doctor-patients-view';

export const metadata: Metadata = {
  title: 'Pacientët · Klinika',
};

// `DoctorPatientsView` reads `useSearchParams()` for the `?patientId=…`
// deep-link from the doctor's home dashboard. Next.js 15 requires that
// such reads sit behind a Suspense boundary so the static prerender
// can bail out cleanly. RouteGate ensures only callers with clinical
// access (doctor OR clinic_admin) land here; receptionists get the
// /forbidden empty state.
export default function DoctorPatientsPage() {
  return (
    <RouteGate required={['doctor', 'clinic_admin']}>
      <Suspense fallback={null}>
        <DoctorPatientsView />
      </Suspense>
    </RouteGate>
  );
}
