import type { ReactNode } from 'react';

/**
 * Single-column centered shell used by the platform-admin login page
 * and the /verify (MFA) route. Mirrors the body chrome of
 * design-reference/prototype/components/mfa-verify.html — full-height
 * stone background, centered grid, fixed teal accent strip across the
 * top.
 */
export function CenteredAuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-stone-50 grid place-items-center px-6 py-10">
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-teal-700 via-teal-500 to-teal-700 z-50"
      />
      {children}
    </main>
  );
}
