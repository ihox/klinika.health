'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useMe } from '@/lib/use-me';

export function PacientetGate() {
  const router = useRouter();
  const { me, loading } = useMe();

  useEffect(() => {
    if (loading || !me) return;
    const hasClinical = me.roles.includes('doctor') || me.roles.includes('clinic_admin');
    if (hasClinical) {
      router.replace('/doctor/pacientet');
    } else {
      // Receptionist-only or roleless: this surface is gated.
      router.replace('/forbidden');
    }
  }, [loading, me, router]);

  // The redirect is near-instant in practice; render the same neutral
  // background as the rest of the clinic shell so the page-flash is
  // invisible.
  return (
    <main className="min-h-screen bg-stone-50 grid place-items-center text-stone-500 text-[13px]">
      Po ngarkohet…
    </main>
  );
}
