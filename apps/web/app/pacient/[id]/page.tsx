import type { Metadata } from 'next';

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
export default async function PatientChartPage({ params }: Params) {
  const { id } = await params;
  return <ChartView patientId={id} />;
}
