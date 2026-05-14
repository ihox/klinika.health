import type { Metadata } from 'next';

import { ChartView } from '../../chart-view';

export const metadata: Metadata = {
  title: 'Kartela · Klinika',
};

interface Params {
  params: Promise<{ id: string; visitId: string }>;
}

// Same chart, opened on a specific visit. The client component
// validates the visit belongs to the patient once data lands; if not,
// it falls back to the most-recent one.
export default async function PatientChartVisitPage({ params }: Params) {
  const { id, visitId } = await params;
  return <ChartView patientId={id} initialVisitId={visitId} />;
}
