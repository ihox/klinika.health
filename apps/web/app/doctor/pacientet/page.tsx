import type { Metadata } from 'next';
import { Suspense } from 'react';

import { DoctorPatientsView } from './doctor-patients-view';

export const metadata: Metadata = {
  title: 'Pacientët · Klinika',
};

// `DoctorPatientsView` reads `useSearchParams()` for the `?patientId=…`
// deep-link from the doctor's home dashboard. Next.js 15 requires that
// such reads sit behind a Suspense boundary so the static prerender
// can bail out cleanly.
export default function DoctorPatientsPage() {
  return (
    <Suspense fallback={null}>
      <DoctorPatientsView />
    </Suspense>
  );
}
