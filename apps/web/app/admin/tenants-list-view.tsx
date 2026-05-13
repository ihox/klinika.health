'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import {
  clinicStatusLabel,
  clinicStatusTone,
  StatusChip,
} from '@/components/admin/status-chip';
import { Button } from '@/components/ui/button';
import { adminClient, type TenantSummary } from '@/lib/admin-client';
import { formatDateAlbanian, formatRelativeAlbanian } from '@/lib/format-relative';

export function TenantsListView() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');

  useEffect(() => {
    let cancelled = false;
    adminClient
      .listTenants()
      .then((out) => {
        if (cancelled) return;
        setTenants(out.tenants);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Gabim i panjohur.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!tenants) return null;
    const q = query.trim().toLowerCase();
    return tenants.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.subdomain.toLowerCase().includes(q) ||
        t.city.toLowerCase().includes(q)
      );
    });
  }, [tenants, query, statusFilter]);

  const summary = useMemo(() => {
    if (!tenants) return null;
    const active = tenants.filter((t) => t.status === 'active').length;
    const suspended = tenants.filter((t) => t.status === 'suspended').length;
    return { active, suspended, total: tenants.length };
  }, [tenants]);

  return (
    <section>
      <header className="flex items-end justify-between gap-6 mb-5">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-stone-900">
            Klinikat
          </h1>
          <p className="mt-1 text-[13px] text-stone-500">
            {summary
              ? `${summary.total} klinika · ${summary.active} aktive · ${summary.suspended} në pezullim`
              : 'Po ngarkohen klinikat…'}
          </p>
        </div>
        <Link href="/admin/tenants/new">
          <Button size="md">+ Krijo klinikë</Button>
        </Link>
      </header>

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-[360px]">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kërko klinikë…"
            className="w-full h-10 pl-10 pr-3 rounded-md bg-white border border-stone-300 text-[13px] placeholder:text-stone-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3 3" strokeLinecap="round" />
            </svg>
          </span>
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
          className="h-10 px-3 rounded-md bg-white border border-stone-300 text-[13px] text-stone-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
        >
          <option value="all">Të gjitha statuset</option>
          <option value="active">Aktive</option>
          <option value="suspended">Në pezullim</option>
        </select>
      </div>

      {error ? (
        <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[13px] p-3">
          {error}
        </div>
      ) : null}

      <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full" data-testid="tenants-table">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-4 py-3">
                Emri
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-4 py-3">
                Subdomain
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-4 py-3">
                Statusi
              </th>
              <th className="text-right text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-4 py-3">
                Pacientë
              </th>
              <th className="text-right text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-4 py-3">
                Përdorues
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-4 py-3">
                Krijuar
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-4 py-3">
                Aktiviteti i fundit
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered === null ? (
              <tr>
                <td colSpan={8} className="text-center text-stone-500 text-[13px] py-10">
                  Po ngarkohet…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-stone-500 text-[13px] py-10">
                  Asnjë klinikë nuk përputhet me filtrat aktualë.
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-stone-100 last:border-b-0 hover:bg-stone-50 cursor-pointer transition-colors"
                  data-testid="tenant-row"
                  onClick={() => {
                    window.location.assign(`/admin/tenants/${t.id}`);
                  }}
                >
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="text-[13px] font-medium text-stone-900 hover:text-teal-700"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 font-mono text-[12.5px] text-stone-500">
                    {t.subdomain}.klinika.health
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusChip tone={clinicStatusTone(t.status)}>
                      {clinicStatusLabel(t.status)}
                    </StatusChip>
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-[13px] text-stone-700">
                    {t.patientCount.toLocaleString('sq-AL')}
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums text-[13px] text-stone-700">
                    {t.userCount}
                  </td>
                  <td className="px-4 py-3.5 tabular-nums text-[13px] text-stone-500">
                    {formatDateAlbanian(t.createdAt)}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] text-stone-500">
                    {formatRelativeAlbanian(t.lastActivityAt)}
                  </td>
                  <td className="px-4 py-3.5 text-right text-stone-400">→</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
