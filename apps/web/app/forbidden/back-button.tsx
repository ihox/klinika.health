'use client';

import { useRouter } from 'next/navigation';

import { homePathForRoles } from '@/lib/auth-client';
import { useMe } from '@/lib/use-me';

/**
 * Sends the user to the role-priority home page (CLAUDE.md §5.8,
 * ADR-004): doctor → /doctor, clinic_admin → /cilesimet,
 * receptionist → /receptionist; platform_admin → /admin; degenerate
 * (no roles) → /profili-im. While `/me` is loading we keep the
 * button enabled but route to /profili-im which is harmless and
 * universally accessible.
 */
export function BackButton() {
  const router = useRouter();
  const { me } = useMe();
  const home = me ? homePathForRoles(me.roles) : '/profili-im';
  return (
    <button
      type="button"
      onClick={() => router.replace(home)}
      className="rounded-md border border-stone-300 bg-white px-3.5 py-2 text-[13px] font-medium text-stone-700 shadow-xs hover:bg-stone-50"
    >
      Kthehu te faqja kryesore
    </button>
  );
}
