import type { Metadata } from 'next';

import { RouteGate } from '@/components/route-gate';

import { ChartView } from './chart-view';

export const metadata: Metadata = {
  title: 'Kartela · Klinika',
};

interface Params {
  params: Promise<{ id: string }>;
}

// Defaults to the most-recent visit. The client component resolves
// the visit id once the chart bundle loads and replaces the URL with
// `/pacient/:id/vizita/:vid` so deep-links and back navigation work.
//
// Doctor-only — receptionists hit /forbidden via RouteGate. The
// underlying API endpoint also returns 403 for receptionists; the
// UI gate keeps stale or guessed URLs from even reaching the chart
// shell.
export default async function PatientChartPage({ params }: Params) {
  const { id } = await params;
  return (
    <RouteGate required={['doctor', 'clinic_admin']}>
      <ChartView patientId={id} />
    </RouteGate>
  );
}
