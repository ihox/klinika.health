'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient, type TrustedDeviceRow } from '@/lib/auth-client';
import { formatDateBelgrade, formatDateTimeBelgrade } from '@/lib/format-date';

interface Props {
  devices: TrustedDeviceRow[];
  onChange: () => Promise<void>;
}

export function TrustedDevicesCard({ devices, onChange }: Props) {
  const [working, setWorking] = useState<string | null>(null);

  const revoke = async (id: string) => {
    setWorking(id);
    try {
      await authClient.revokeTrustedDevice(id);
      await onChange();
    } finally {
      setWorking(null);
    }
  };

  const revokeAll = async () => {
    setWorking('all');
    try {
      await authClient.revokeAllTrustedDevices();
      await onChange();
    } finally {
      setWorking(null);
    }
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6 mb-6">
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-[16px] font-semibold text-stone-900">Pajisjet e besueshme</h2>
        <span className="text-[12px] text-stone-400">
          {devices.length === 0
            ? '0 pajisje'
            : `${devices.length} ${devices.length === 1 ? 'pajisje' : 'pajisje'} · besimi vlen 30 ditë`}
        </span>
      </header>

      {devices.length === 0 ? (
        <div className="rounded-md border border-stone-100 bg-stone-50 p-6 text-center text-[13px] text-stone-500">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2 text-stone-400"
          >
            <path d="M12 3l8 3.5v5c0 4.4-3.4 8-8 9.5-4.6-1.5-8-5.1-8-9.5v-5L12 3z" />
            <path d="M9 11.5l2 2 4-4" />
          </svg>
          <div className="text-stone-800 font-medium">Asnjë pajisje e besueshme deri tani.</div>
          <div className="mt-1">Pas hyrjes së parë me kod, pajisja juaj do të shfaqet këtu.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {devices.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-md border border-stone-100 p-3"
            >
              <div className="h-9 w-9 rounded-md bg-stone-50 border border-stone-200 text-stone-500 grid place-items-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="14" height="9" rx="1" />
                  <path d="M6 15h6M9 12v3" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] text-stone-900 font-medium flex items-center gap-2">
                  {d.label}
                  {d.isCurrent ? (
                    <span className="rounded-full bg-green-50 text-green-700 border border-green-100 px-1.5 py-0.5 text-[10.5px] font-medium">
                      kjo pajisje
                    </span>
                  ) : null}
                </div>
                <div className="text-[12px] text-stone-500 mt-0.5">
                  Që nga {formatDateBelgrade(d.createdAt)} · hyrja e fundit{' '}
                  {formatDateTimeBelgrade(d.lastSeenAt)} · IP {d.ipAddress}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revoke(d.id)}
                disabled={working === d.id}
                className="text-[13px] font-medium text-teal-700 hover:text-teal-800 hover:underline disabled:text-stone-400"
              >
                {working === d.id ? '…' : 'Hiq besimin'}
              </button>
            </div>
          ))}
        </div>
      )}

      {devices.length > 0 ? (
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" size="sm" onClick={revokeAll} disabled={working === 'all'}>
            Hiq besimin për të gjitha
          </Button>
        </div>
      ) : null}
    </section>
  );
}
