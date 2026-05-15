'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { PasswordChangeCard } from './password-change-card';
import { TrustedDevicesCard } from './trusted-devices-card';
import { SessionsCard } from './sessions-card';
import { ClinicTopNav } from '@/components/clinic-top-nav';
import { RoleChip } from '@/components/role-chip';
import { ApiError } from '@/lib/api';
import { authClient, type MeResponse, type SessionRow, type TrustedDeviceRow } from '@/lib/auth-client';
import { formatDateBelgrade, formatDateTimeBelgrade } from '@/lib/format-date';
import { type ClinicRole, orderRoles } from '@/lib/role-labels';

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
      <main className="min-h-screen bg-stone-50">
        <ClinicTopNav me={me} />
        <div className="grid place-items-center py-24 text-stone-500">Po ngarkohet…</div>
      </main>
    );
  }

  if (error || !me) {
    return (
      <main className="min-h-screen bg-stone-50">
        <ClinicTopNav me={me} />
        <div className="grid place-items-center py-24">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
            {error ?? 'Nuk u ngarkua profili.'}
          </div>
        </div>
      </main>
    );
  }

  // The chips card shows only clinic-scope roles; platform_admin
  // never reaches the clinic profile surface (its own /admin shell
  // has a separate identity card).
  const clinicRoles: ClinicRole[] = orderRoles(me.roles).filter(
    (r): r is ClinicRole =>
      r === 'doctor' || r === 'receptionist' || r === 'clinic_admin',
  );

  return (
    <main className="min-h-screen bg-stone-50">
      <ClinicTopNav me={me} />
      <div className="max-w-3xl mx-auto py-10 px-4">
        <h1 className="font-display text-[28px] font-semibold tracking-[-0.025em] text-stone-900 mb-1">
          Profili im
        </h1>
        <div className="text-[13px] text-stone-500 mb-6">
          Të dhënat tuaja personale. Të menaxhuara nga administratori i klinikës.
        </div>

        {/* Identity — read-only */}
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
              <div className="mt-2 text-[12.5px] text-stone-600">{me.clinicShortName}</div>
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

        {/* Roles — read-only chips + helper */}
        <section
          className="rounded-xl border border-stone-200 bg-white p-6 mb-6"
          data-testid="profile-roles-card"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-[15px] font-semibold text-stone-900">
              Rolet e mia
            </h2>
            <span className="text-[12px] text-stone-400">Vetëm-lexim</span>
          </div>
          {clinicRoles.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {clinicRoles.map((r) => (
                <RoleChip key={r} role={r} />
              ))}
            </div>
          ) : (
            <div className="text-[13px] text-stone-500 mb-3">Asnjë rol i caktuar.</div>
          )}
          <div className="flex items-start gap-2.5 rounded-md border border-stone-200 bg-stone-50 px-3 py-2.5 text-[12.5px] text-stone-600">
            <span
              className="h-4 w-4 rounded-full bg-white text-stone-500 grid place-items-center text-[10px] font-semibold shrink-0 mt-[1px] border border-stone-300"
              aria-hidden="true"
            >
              i
            </span>
            <div>
              Për të ndryshuar rolet tuaja, kontaktoni administratorin e klinikës.
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
      </div>
    </main>
  );
}
