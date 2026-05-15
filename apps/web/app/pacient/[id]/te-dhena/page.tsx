import type { Metadata } from 'next';

import { RouteGate } from '@/components/route-gate';

import { MasterDataView } from './master-data-view';

export const metadata: Metadata = {
  title: 'Të dhënat e pacientit · Klinika',
};

interface Params {
  params: Promise<{ id: string }>;
}

// Doctor-only surface — receptionists get the /forbidden empty
// state via RouteGate. The chart view at /pacient/[id] uses the same
// gate (its data fetch returns 403, this gate makes it explicit).
export default async function MasterDataPage({ params }: Params) {
  const { id } = await params;
  return (
    <RouteGate required={['doctor', 'clinic_admin']}>
      <MasterDataView patientId={id} />
    </RouteGate>
  );
}
