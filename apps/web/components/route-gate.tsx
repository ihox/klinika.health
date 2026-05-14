'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import type { AuthRole } from '@/lib/auth-client';
import { useMe } from '@/lib/use-me';

interface Props {
  /**
   * Roles that grant access. OR semantics: the user passes if their
   * role array intersects this list. An empty `required` array is
   * treated as "any authenticated clinic user".
   */
  required: AuthRole[];
  children: React.ReactNode;
}

/**
 * Client-side role gate that redirects to /forbidden when the
 * authenticated user doesn't carry any of the `required` roles
 * (CLAUDE.md §5.8, ADR-004 Multi-role update).
 *
 * This is the same-scope 403 — the user is on a clinic surface and
 * authenticated, but their role doesn't grant this particular page.
 * Cross-scope routes (apex hitting /cilesimet, tenant hitting /admin)
 * are 404'd by the Next.js middleware much earlier and never reach
 * this component.
 */
export function RouteGate({ required, children }: Props) {
  const router = useRouter();
  const { me, loading } = useMe();
  const allowed =
    required.length === 0
      ? Boolean(me)
      : (me?.roles.some((r) => required.includes(r)) ?? false);

  useEffect(() => {
    if (loading || !me) return;
    if (!allowed) router.replace('/forbidden');
  }, [loading, me, allowed, router]);

  // While `/me` is in flight we render a neutral placeholder rather
  // than the protected content. The 403 redirect fires the moment
  // roles arrive.
  if (loading || !me || !allowed) {
    return (
      <main className="min-h-screen bg-stone-50 grid place-items-center text-stone-500 text-[13px]">
        Po ngarkohet…
      </main>
    );
  }
  return <>{children}</>;
}
