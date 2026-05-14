'use client';

import { useRouter } from 'next/navigation';

export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="rounded-md border border-stone-300 bg-white px-3.5 py-2 text-[13px] font-medium text-stone-700 shadow-xs hover:bg-stone-50"
    >
      Kthehu mbrapa
    </button>
  );
}
