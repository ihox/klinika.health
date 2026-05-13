import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Sot · Klinika',
};

export default function DoctorHome() {
  return (
    <main className="min-h-screen bg-stone-50 p-10">
      <div className="max-w-4xl mx-auto">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-stone-900">
          Sot
        </h1>
        <p className="mt-2 text-stone-500 text-[14px]">
          Faqja e mjekut do të ndërtohet në një slice të mëvonshëm.
        </p>
        <div className="mt-6">
          <Link href="/profili-im" className="text-teal-700 hover:underline font-medium text-[14px]">
            Profili im →
          </Link>
        </div>
      </div>
    </main>
  );
}
