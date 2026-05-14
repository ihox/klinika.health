import type { Metadata } from 'next';

import { PacientetGate } from './pacientet-gate';

export const metadata: Metadata = {
  title: 'Pacientët — Klinika',
};

/**
 * Role-aware /pacientet wrapper (CLAUDE.md §5.8, ADR-004).
 *
 *   - doctor or clinic_admin → redirect to /doctor/pacientet (the
 *     existing doctor patient browser).
 *   - receptionist only      → render the 403 "no access" page.
 *   - degenerate (no roles)  → 403 too — the navigation should never
 *     have surfaced this link to a roleless user.
 *
 * The dispatch happens client-side because the role check needs the
 * authenticated session cookie which only the API can validate
 * cheaply. Server-side dispatch would re-implement the API's role
 * resolution in Next; the wrapper instead defers to the API via
 * `/api/auth/me`.
 */
export default function PacientetPage() {
  return <PacientetGate />;
}
