'use client';

import { useEffect, useState } from 'react';

import { StatusChip } from '@/components/admin/status-chip';
import { adminClient, type PlatformHealthSnapshot } from '@/lib/admin-client';
import { formatRelativeAlbanian } from '@/lib/format-relative';

const POLL_INTERVAL_MS = 60_000;

/**
 * Polls `/api/admin/health` every 60s — the dashboard updates
 * silently while the operator keeps the tab open. The polling cadence
 * matches the alert engine's per-tenant heartbeat schedule, so the
 * dashboard reflects what was true at the most recent heartbeat.
 *
 * TanStack Query would manage this stale-while-revalidate flow more
 * cleanly; that's queued for the slice that introduces shared query
 * state across admin + tenant surfaces.
 */
export function PlatformHealthView() {
  const [snapshot, setSnapshot] = useState<PlatformHealthSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await adminClient.healthSnapshot();
        if (!cancelled) {
          setSnapshot(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Gabim i panjohur.');
        }
      }
    };
    void load();
    const handle = window.setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const overall = snapshot
    ? snapshot.systems.every((s) => s.status === 'ok')
      ? ('ok' as const)
      : snapshot.systems.some((s) => s.status === 'critical')
        ? ('critical' as const)
        : ('warning' as const)
    : null;

  return (
    <section>
      <header className="flex items-end justify-between gap-6 mb-5">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-stone-900">
            Sistemi
          </h1>
          <p className="mt-1 text-[13px] text-stone-500">
            {snapshot
              ? `Përditësuar ${formatRelativeAlbanian(snapshot.generatedAt)}`
              : 'Po ngarkohet…'}
          </p>
        </div>
        {overall ? (
          <StatusChip
            tone={overall === 'ok' ? 'green' : overall === 'warning' ? 'amber' : 'red'}
          >
            {overall === 'ok'
              ? 'Të gjitha sistemet të shëndetshme'
              : overall === 'warning'
                ? 'Ka paralajmërime'
                : 'Probleme kritike'}
          </StatusChip>
        ) : null}
      </header>

      {error ? (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[13px] p-3">
          {error}
        </div>
      ) : null}

      {snapshot ? (
        <>
          <div className="grid grid-cols-3 gap-4 mb-5">
            <StatCard label="Klinikat">
              <StatRow label="Totali" value={snapshot.tenants.total} />
              <StatRow label="Aktive" value={snapshot.tenants.active} accent="green" />
              <StatRow label="Pezullim" value={snapshot.tenants.suspended} accent="amber" />
            </StatCard>
            <StatCard label="Përdoruesit">
              <StatRow label="Totali" value={snapshot.users.total} />
              <StatRow label="Aktivë sot" value={snapshot.users.activeToday} accent="green" />
            </StatCard>
            <StatCard label="Pacientët">
              <StatRow label="Totali" value={snapshot.patients.total} />
              <StatRow label="Vizita këtë muaj" value={snapshot.patients.visitsThisMonth} />
            </StatCard>
          </div>

          <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden mb-5">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200">
              <h3 className="text-[13px] font-semibold text-stone-900">Sistemet</h3>
              <span className="text-[11.5px] text-stone-400">Kontroll automatik çdo 60s</span>
            </div>
            <div className="divide-y divide-stone-100">
              {snapshot.systems.map((s) => (
                <div
                  key={s.key}
                  className="grid grid-cols-[24px_160px_1fr_auto] items-center gap-3 px-5 py-3 text-[13px]"
                  data-testid="health-system-row"
                >
                  <span
                    className={`h-4 w-4 rounded-full grid place-items-center text-[10px] font-bold ${
                      s.status === 'ok'
                        ? 'bg-emerald-100 text-emerald-700'
                        : s.status === 'warning'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                    aria-hidden="true"
                  >
                    {s.status === 'ok' ? '✓' : '!'}
                  </span>
                  <span className="text-stone-500">{s.label}</span>
                  <span className="text-stone-900">{s.detail}</span>
                  <span className="font-mono text-[11.5px] text-stone-400">
                    {formatRelativeAlbanian(s.lastCheckedAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200">
              <h3 className="text-[13px] font-semibold text-stone-900">Paralajmërime të fundit</h3>
              <span className="text-[11.5px] text-stone-400">
                Top {snapshot.recentAlerts.length}
              </span>
            </div>
            {snapshot.recentAlerts.length === 0 ? (
              <div className="p-8 text-center text-stone-500 text-[13px]">
                Asnjë paralajmërim së fundi.
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-200">
                    <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                      Koha
                    </th>
                    <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                      Klinika
                    </th>
                    <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                      Tipi
                    </th>
                    <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                      Mesazhi
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.recentAlerts.map((a) => (
                    <tr key={a.id} className="border-b border-stone-100 last:border-b-0">
                      <td className="px-5 py-3 font-mono text-[12px] text-stone-500">
                        {formatRelativeAlbanian(a.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-stone-900 font-medium">
                        {a.tenantId}
                      </td>
                      <td className="px-5 py-3 text-[13px]">
                        <StatusChip tone={a.severity === 'critical' ? 'red' : 'amber'}>
                          {a.severity === 'critical' ? 'Kritik' : 'Paralajmërim'}
                        </StatusChip>
                      </td>
                      <td className="px-5 py-3 text-[13px] text-stone-700">{a.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-sm px-5 py-4">
      <div className="text-[11px] uppercase tracking-[0.08em] text-stone-400 font-semibold mb-3">
        {label}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function StatRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: 'green' | 'amber';
}) {
  const accentClass =
    accent === 'green' ? 'text-emerald-600' : accent === 'amber' ? 'text-amber-600' : 'text-stone-900';
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] text-stone-500">{label}</span>
      <span className={`font-display text-[18px] font-semibold tabular-nums ${accentClass}`}>
        {value.toLocaleString('sq-AL')}
      </span>
    </div>
  );
}
