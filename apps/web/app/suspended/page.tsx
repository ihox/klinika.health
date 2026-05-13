import type { Metadata } from 'next';

import { AuthShell } from '@/components/auth/auth-shell';

export const metadata: Metadata = {
  title: 'Klinika e pezulluar',
};

export default function SuspendedPage() {
  return (
    <AuthShell
      title="Klinika juaj është pezulluar"
      subtitle="Hyrja është bllokuar përkohësisht."
      footer={<span>klinika.health</span>}
    >
      <div className="flex flex-col gap-4 text-[14px] text-stone-700 leading-relaxed">
        <p>
          Aksesi në këtë klinikë është ndaluar nga administratori i platformës. Të dhënat janë të
          ruajtura në mënyrë të sigurt dhe nuk janë fshirë.
        </p>
        <p>
          Për ta riaktivizuar, kontaktoni administratorin e Klinikës që menaxhon llogarinë e kësaj
          klinike, ose shkruani te <a href="mailto:support@klinika.health" className="text-teal-700 hover:underline">support@klinika.health</a>.
        </p>
      </div>
    </AuthShell>
  );
}
