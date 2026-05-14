import type { Metadata } from 'next';

import { PatientSearchView } from './patient-search-view';

export const metadata: Metadata = {
  title: 'Pacientët · Klinika',
};

export default function ReceptionistPatientsPage() {
  return <PatientSearchView />;
}
