import type { Metadata } from 'next';

import { RouteGate } from '@/components/route-gate';

import { RaportiView } from './raporti-view';

export const metadata: Metadata = {
  title: 'Raporti i ditës · Klinika',
};

/**
 * Raporti i ditës — daily revenue + visit reconciliation page.
 *
 * Open to doctor, receptionist, and clinic_admin per ADR-019. The
 * server-side endpoint additionally restricts receptionist to
 * today + yesterday; the page surfaces an inline restricted-banner
 * (see RaportiView) when a 403 with reason='date_out_of_range' comes
 * back. Platform admins are blocked at the cross-scope routing layer.
 */
export default function RaportiPage() {
  return (
    <RouteGate required={['doctor', 'receptionist', 'clinic_admin']}>
      <RaportiView />
    </RouteGate>
  );
}
