import type { Metadata } from 'next';

import { PamjaEDitesGate } from './pamja-gate';

export const metadata: Metadata = {
  title: 'Pamja e ditës · Klinika',
};

/**
 * Albanian-route alias for /doctor (CLAUDE.md §5.8). Doctors land on
 * /doctor; the alias exists so the literal URL referenced in the
 * smoke-test ("Erëblirë typing /pamja-e-dites → 403") behaves
 * correctly without renaming the existing /doctor route folder.
 */
export default function PamjaEDitesPage() {
  return <PamjaEDitesGate />;
}
