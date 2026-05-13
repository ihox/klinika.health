'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { PasswordChangeCard } from './password-change-card';
import { TrustedDevicesCard } from './trusted-devices-card';
import { SessionsCard } from './sessions-card';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { authClient, type MeResponse, type SessionRow, type TrustedDeviceRow } from '@/lib/auth-client';
import { formatDateBelgrade, formatDateTimeBelgrade } from '@/lib/format-date';

export function ProfilePage() {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse['user'] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [devices, setDevices] = useState<TrustedDeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, sess, dev] = await Promise.all([
        authClient.me(),
        authClient.sessions(),
        authClient.trustedDevices(),
      ]);
      setMe(profile.user);
      setSessions(sess.sessions);
      setDevices(dev.devices);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace('/login?reason=session-expired');
        return;
      }
      setError('Diçka shkoi keq. Provoni të rifreskoni faqen.');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 grid place-items-center text-stone-500">
        Po ngarkohet…
      </main>
    );
  }

  if (error || !me) {
    return (
      <main className="min-h-screen bg-stone-50 grid place-items-center">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          {error ?? 'Nuk u ngarkua profili.'}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 py-10 px-4">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-stone-900 mb-6">
          Profili im
        </h1>

        <section className="rounded-xl border border-stone-200 bg-white p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-teal-100 text-teal-800 font-medium grid place-items-center text-[18px]">
              {me.firstName.charAt(0)}
              {me.lastName.charAt(0)}
            </div>
            <div className="flex-1">
              <div className="font-display text-[20px] font-semibold text-stone-900">
                {me.title ? `${me.title} ` : ''}
                {me.firstName} {me.lastName}
              </div>
              <div className="text-[13px] text-stone-500 mt-0.5">{me.email}</div>
              <div className="mt-2 flex items-center gap-2 text-[12.5px]">
                <span className="rounded-full bg-teal-50 text-teal-800 px-2 py-0.5 font-medium">
                  {roleLabel(me.role)}
                </span>
                <span className="text-stone-400">·</span>
                <span className="text-stone-600">{me.clinicShortName}</span>
              </div>
            </div>
            <div className="hidden sm:flex flex-col items-end gap-3 text-[12px] text-stone-500">
              <div>
                <div className="uppercase tracking-wide text-[11px] text-stone-400 mb-0.5">
                  I lidhur që nga
                </div>
                <div className="text-stone-700 font-medium">{formatDateBelgrade(me.createdAt)}</div>
              </div>
              <div>
                <div className="uppercase tracking-wide text-[11px] text-stone-400 mb-0.5">
                  Hyrja e fundit
                </div>
                <div className="text-stone-700 font-medium">
                  {formatDateTimeBelgrade(me.lastLoginAt)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <PasswordChangeCard />

        <TrustedDevicesCard
          devices={devices}
          onChange={load}
        />

        <SessionsCard
          sessions={sessions}
          onChange={load}
        />

        <div className="mt-6 rounded-md border border-stone-200 bg-white p-4 text-[12.5px] text-stone-600 flex gap-2">
          <span
            className="h-4 w-4 rounded-full bg-stone-100 text-stone-500 grid place-items-center text-[10px] font-semibold shrink-0 mt-px"
            aria-hidden="true"
          >
            i
          </span>
          <div>
            Për të ndryshuar <strong className="text-stone-800">emrin</strong>,{' '}
            <strong className="text-stone-800">email-in</strong> ose{' '}
            <strong className="text-stone-800">nënshkrimin</strong> tuaj, kontaktoni
            administratorin e klinikës.
          </div>
        </div>

        <div className="mt-8 flex justify-end">
          <Button
            variant="ghost"
            onClick={async () => {
              await authClient.logout().catch(() => undefined);
              router.replace('/login');
            }}
          >
            Dil
          </Button>
        </div>
      </div>
    </main>
  );
}

function roleLabel(role: MeResponse['user']['role']): string {
  switch (role) {
    case 'doctor':
      return 'Mjek';
    case 'receptionist':
      return 'Recepsionist';
    case 'clinic_admin':
      return 'Admin i klinikës';
    case 'platform_admin':
      return 'Admin platforme';
  }
}
