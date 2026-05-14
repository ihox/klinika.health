'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { useMe } from '@/lib/use-me';

export function PamjaEDitesGate() {
  const router = useRouter();
  const { me, loading } = useMe();

  useEffect(() => {
    if (loading || !me) return;
    if (me.roles.includes('doctor')) {
      router.replace('/doctor');
    } else {
      router.replace('/forbidden');
    }
  }, [loading, me, router]);

  return (
    <main className="min-h-screen bg-stone-50 grid place-items-center text-stone-500 text-[13px]">
      Po ngarkohet…
    </main>
  );
}
