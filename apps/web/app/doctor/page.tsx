import type { Metadata } from 'next';

import { DashboardView } from './dashboard-view';

export const metadata: Metadata = {
  title: 'Sot · Klinika',
};

export default function DoctorHome() {
  return <DashboardView />;
}
