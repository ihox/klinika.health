'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { authClient, type SessionRow } from '@/lib/auth-client';
import { formatDateTimeBelgrade } from '@/lib/format-date';

interface Props {
  sessions: SessionRow[];
  onChange: () => Promise<void>;
}

export function SessionsCard({ sessions, onChange }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);

  const revokeOthers = async () => {
    setWorking(true);
    try {
      await authClient.revokeOtherSessions();
      await onChange();
    } finally {
      setWorking(false);
      setConfirming(false);
    }
  };

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6 mb-6">
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-[16px] font-semibold text-stone-900">Veprime</h2>
        <span className="text-[12px] text-stone-400">
          Sesionet aktive: {sessions.length}
        </span>
      </header>

      <div className="flex flex-col gap-2.5">
        {sessions.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-3 rounded-md border border-stone-100 p-3 text-[13px]"
          >
            <div className="flex-1">
              <div className="font-medium text-stone-900 flex items-center gap-2">
                {s.deviceLabel}
                {s.isCurrent ? (
                  <span className="rounded-full bg-green-50 text-green-700 border border-green-100 px-1.5 py-0.5 text-[10.5px] font-medium">
                    kjo pajisje
                  </span>
                ) : null}
              </div>
              <div className="text-[12px] text-stone-500 mt-0.5">
                {s.ipAddress} · përdoruar së fundi {formatDateTimeBelgrade(s.lastUsedAt)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex justify-end">
        <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
          Dilni nga të gjitha sesionet e tjera
        </Button>
      </div>

      {confirming ? (
        <div className="fixed inset-0 bg-stone-900/30 grid place-items-center p-4 z-50">
          <div className="bg-white rounded-xl border border-stone-200 shadow-2xl max-w-md w-full p-6">
            <h3 className="font-display text-[18px] font-semibold text-stone-900">
              Dilni nga sesionet e tjera?
            </h3>
            <p className="mt-2 text-[13px] text-stone-600 leading-relaxed">
              Të gjitha sesionet e tjera përveç këtij do të mbyllen menjëherë. Pajisjet e besueshme
              mbeten të besueshme — hyrja tjetër nga to nuk do të kërkojë kod të ri.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={working}>
                Anulo
              </Button>
              <Button onClick={revokeOthers} disabled={working}>
                {working ? 'Po mbyllen…' : 'Po, mbyllni sesionet'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
