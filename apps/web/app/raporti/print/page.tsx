import type { Metadata } from 'next';

import { RouteGate } from '@/components/route-gate';

import { RaportiPrintView } from './raporti-print-view';

export const metadata: Metadata = {
  title: 'Raporti i ditës · printim · Klinika',
};

/**
 * /raporti/print?date=YYYY-MM-DD[&print=1]
 *
 * Standalone A4 portrait print view. Same role gating as /raporti
 * (doctor, receptionist, clinic_admin per ADR-019); the API enforces
 * receptionist date restriction independently. Add `?print=1` to
 * trigger window.print() automatically after the data lands —
 * matches the prototype's behaviour for "open print dialog from a
 * fresh tab".
 *
 * The QR code from the prototype is deliberately NOT rendered per
 * the task brief — the document is for internal archive only and
 * the QR was a decorative element.
 */
export default function RaportiPrintPage() {
  return (
    <RouteGate required={['doctor', 'receptionist', 'clinic_admin']}>
      <RaportiPrintView />
    </RouteGate>
  );
}
