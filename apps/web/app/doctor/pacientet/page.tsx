import type { Metadata } from 'next';

import { DoctorPatientsView } from './doctor-patients-view';

export const metadata: Metadata = {
  title: 'Pacientët · Klinika',
};

export default function DoctorPatientsPage() {
  return <DoctorPatientsView />;
}
