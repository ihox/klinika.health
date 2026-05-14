import type { Metadata } from 'next';

import { RouteGate } from '@/components/route-gate';

import { DashboardView } from './dashboard-view';

export const metadata: Metadata = {
  title: 'Pamja e ditës · Klinika',
};

export default function DoctorHome() {
  // Pamja e ditës is granted by the doctor role only (CLAUDE.md §5.8).
  // A user without it (receptionist-only, clinic_admin-only) gets the
  // /forbidden empty state if they type the URL directly.
  return (
    <RouteGate required={['doctor']}>
      <DashboardView />
    </RouteGate>
  );
}
