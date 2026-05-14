'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  clinicStatusLabel,
  clinicStatusTone,
  StatusChip,
} from '@/components/admin/status-chip';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { adminClient, type TenantDetail } from '@/lib/admin-client';
import { formatDateAlbanian, formatRelativeAlbanian } from '@/lib/format-relative';

interface TenantDetailViewProps {
  id: string;
}

export function TenantDetailView({ id }: TenantDetailViewProps) {
  const searchParams = useSearchParams();
  const justCreated = searchParams?.get('created') === '1';
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const out = await adminClient.getTenant(id);
      setTenant(out.tenant);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('Klinika nuk u gjet.');
      } else {
        setError(err instanceof Error ? err.message : 'Gabim i panjohur.');
      }
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSuspend = async () => {
    if (!tenant) return;
    if (
      !window.confirm(
        `Konfirmoni pezullimin e klinikës "${tenant.name}". Përdoruesit nuk do të mund të hyjnë derisa ta riaktivizoni.`,
      )
    ) {
      return;
    }
    setActionError(null);
    setBusy(true);
    try {
      const out = await adminClient.suspendTenant(tenant.id);
      setTenant(out.tenant);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Pezullimi dështoi.');
    } finally {
      setBusy(false);
    }
  };

  const onActivate = async () => {
    if (!tenant) return;
    setActionError(null);
    setBusy(true);
    try {
      const out = await adminClient.activateTenant(tenant.id);
      setTenant(out.tenant);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Aktivizimi dështoi.');
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <section>
        <Link href="/admin" className="text-[13px] text-stone-500 hover:text-teal-700">
          ← Klinikat
        </Link>
        <div className="mt-6 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[13px] p-3">
          {error}
        </div>
      </section>
    );
  }
  if (!tenant) {
    return <div className="text-stone-500 text-sm py-10 text-center">Po ngarkohet…</div>;
  }

  return (
    <section>
      <nav className="flex items-center gap-2 text-[12px] text-stone-500 mb-2">
        <Link href="/admin" className="hover:text-teal-700">
          ← Klinikat
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-stone-700 font-medium" data-testid="tenant-breadcrumb">
          {tenant.name}
        </span>
      </nav>

      {justCreated ? (
        <div className="mb-5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900 text-[13px] p-3">
          Klinika u krijua. Email-i me fjalëkalimin e përkohshëm u dërgua tek adminit.
        </div>
      ) : null}

      <header className="flex items-start justify-between gap-6 pb-5 border-b border-stone-200 mb-6">
        <div>
          <h1 className="font-display text-[28px] font-semibold tracking-[-0.02em] text-stone-900 flex items-center gap-3">
            {tenant.name}
            <StatusChip tone={clinicStatusTone(tenant.status)} className="text-[12px]">
              <span data-testid="tenant-status">{clinicStatusLabel(tenant.status)}</span>
            </StatusChip>
          </h1>
          <div className="mt-2 font-mono text-[13px] text-stone-500">
            {tenant.subdomain}.klinika.health
          </div>
        </div>
      </header>

      {actionError ? (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[13px] p-3">
          {actionError}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-5 mb-6">
        <Card title="Identiteti">
          <KvRow label="Emri i plotë" value={tenant.name} />
          <KvRow label="Emri i shkurtuar" value={tenant.shortName} />
          <KvRow label="Krijuar" value={formatDateAlbanian(tenant.createdAt)} mono />
          <KvRow label="Qyteti" value={tenant.city} />
          <KvRow
            label="Telefonat"
            value={tenant.phones.length > 0 ? tenant.phones.join(', ') : '—'}
            mono
          />
          <KvRow label="Email kontakti" value={tenant.contactEmail} />
          <KvRow label="Adresa" value={tenant.address} />
        </Card>
        <Card title="Përdorimi">
          <KvRow label="Pacientë" value={tenant.patientCount.toLocaleString('sq-AL')} numeric />
          <KvRow label="Vizita gjithsej" value={tenant.visitCount.toLocaleString('sq-AL')} numeric />
          <KvRow label="Përdorues" value={`${tenant.userCount}`} numeric />
          <KvRow
            label="Aktiviteti i fundit"
            value={formatRelativeAlbanian(tenant.lastActivityAt)}
          />
          <KvRow
            label="Heartbeat i fundit"
            value={formatRelativeAlbanian(tenant.telemetry.lastHeartbeatAt)}
          />
          <KvRow
            label="Backup i fundit"
            value={formatRelativeAlbanian(tenant.telemetry.lastBackupAt)}
          />
        </Card>
      </div>

      <Card title="Statusi operativ" headerMeta={`Përditësuar tani`}>
        <SystemList tenant={tenant} />
      </Card>

      <div className="mt-6">
        <Card title={`Përdoruesit (${tenant.users.length})`} headerMeta="Vetëm shfaqje">
          {tenant.users.length === 0 ? (
            <div className="p-8 text-center text-stone-500 text-[13px]">
              Asnjë përdorues. Admini i parë do të krijojë pas hyrjes së parë.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50">
                  <Th>Emri</Th>
                  <Th>Roli</Th>
                  <Th>Email</Th>
                  <Th>Statusi</Th>
                  <Th>Hyrja e fundit</Th>
                </tr>
              </thead>
              <tbody>
                {tenant.users.map((u) => (
                  <tr key={u.id} className="border-b border-stone-100 last:border-b-0">
                    <Td bold>
                      {u.firstName} {u.lastName}
                    </Td>
                    <Td muted>{u.roles.map(roleLabel).join(', ')}</Td>
                    <Td className="font-mono text-[12px] text-stone-500">{u.email}</Td>
                    <Td>
                      <StatusChip tone={u.isActive ? 'green' : 'stone'}>
                        {u.isActive ? 'Aktiv' : 'Çaktivizuar'}
                      </StatusChip>
                    </Td>
                    <Td muted>{formatRelativeAlbanian(u.lastLoginAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Aktiviteti i fundit" headerMeta="Veprime të rëndësishme">
          {tenant.recentAudit.length === 0 ? (
            <div className="p-6 text-center text-stone-500 text-[13px]">
              Asnjë veprim i regjistruar së fundi.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-stone-200 bg-stone-50">
                  <Th>Koha</Th>
                  <Th>Veprimi</Th>
                  <Th>Përdoruesi</Th>
                </tr>
              </thead>
              <tbody>
                {tenant.recentAudit.map((row) => (
                  <tr key={row.id} className="border-b border-stone-100 last:border-b-0">
                    <Td muted className="font-mono text-[12px]">
                      {formatRelativeAlbanian(row.timestamp)}
                    </Td>
                    <Td>{row.action}</Td>
                    <Td muted className="font-mono text-[12px]">
                      {row.actorEmail ?? '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-6">
        <Card title="Veprime">
          <div className="flex items-center gap-3 px-5 py-4 flex-wrap">
            <span className="text-[13px] text-stone-500 mr-auto">
              {tenant.status === 'active'
                ? 'Pezulloni hyrjen për të bllokuar përkohësisht të gjithë përdoruesit.'
                : 'Riaktivizimi rikthen hyrjen për të gjithë përdoruesit ekzistues.'}
            </span>
            {tenant.status === 'active' ? (
              <Button
                variant="secondary"
                onClick={onSuspend}
                disabled={busy}
                data-testid="suspend-tenant"
              >
                {busy ? 'Po pezullohet…' : 'Pezullo'}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={onActivate}
                disabled={busy}
                data-testid="activate-tenant"
              >
                {busy ? 'Po aktivizohet…' : 'Aktivizo'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}

function SystemList({ tenant }: { tenant: TenantDetail }) {
  const t = tenant.telemetry;
  if (!t.lastHeartbeatAt) {
    return (
      <div className="p-6 text-center text-stone-500 text-[13px]">
        Asnjë heartbeat i freskët nga kjo klinikë.
      </div>
    );
  }
  return (
    <div className="divide-y divide-stone-100">
      <SystemRow
        label="Aplikacioni"
        ok={t.appHealthy === true}
        value={t.appHealthy === true ? 'I shëndetshëm' : 'I paarritshëm'}
      />
      <SystemRow
        label="Database"
        ok={t.dbHealthy === true}
        value={t.dbHealthy === true ? 'I shëndetshëm' : 'I paarritshëm'}
      />
      <SystemRow
        label="Orthanc (DICOM)"
        ok={t.orthancHealthy === true}
        value={
          t.orthancHealthy === true
            ? 'I lidhur'
            : t.orthancHealthy === false
              ? 'I paarritshëm'
              : 'Pa konfigurim'
        }
      />
      <PercentRow label="CPU" percent={t.cpuPercent} />
      <PercentRow label="RAM" percent={t.ramPercent} />
      <PercentRow label="Disk" percent={t.diskPercent} />
      <SystemRow
        label="Radha e punëve"
        ok={t.queueDepth !== null && t.queueDepth < 50}
        value={t.queueDepth !== null ? `${t.queueDepth} punë në pritje` : '—'}
      />
      <SystemRow
        label="Gabime 5xx (5 min)"
        ok={t.errorRate5xx === null || t.errorRate5xx < 5}
        value={t.errorRate5xx !== null ? `${t.errorRate5xx} gabime` : '—'}
      />
    </div>
  );
}

function SystemRow({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="grid grid-cols-[24px_160px_1fr_auto] items-center gap-3 px-5 py-3 text-[13px]">
      <span
        className={`h-4 w-4 rounded-full grid place-items-center text-[10px] font-bold ${
          ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}
        aria-hidden="true"
      >
        {ok ? '✓' : '!'}
      </span>
      <span className="text-stone-500">{label}</span>
      <span className="text-stone-900">{value}</span>
      <span />
    </div>
  );
}

function PercentRow({ label, percent }: { label: string; percent: number | null }) {
  if (percent === null) {
    return <SystemRow label={label} ok={true} value="—" />;
  }
  const tone =
    percent >= 95 ? 'bg-red-500' : percent >= 85 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="grid grid-cols-[24px_160px_1fr_60px] items-center gap-3 px-5 py-3 text-[13px]">
      <span
        className={`h-4 w-4 rounded-full grid place-items-center text-[10px] font-bold ${
          percent < 85 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
        }`}
        aria-hidden="true"
      >
        {percent < 85 ? '✓' : '!'}
      </span>
      <span className="text-stone-500">{label}</span>
      <div className="h-2 rounded-full bg-stone-100 overflow-hidden">
        <div
          className={`h-full ${tone}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="text-right text-stone-700 tabular-nums">{percent.toFixed(0)}%</span>
    </div>
  );
}

function Card({
  title,
  children,
  headerMeta,
}: {
  title: string;
  children: React.ReactNode;
  headerMeta?: string;
}) {
  return (
    <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200">
        <h3 className="text-[13px] font-semibold text-stone-900">{title}</h3>
        {headerMeta ? <span className="text-[11.5px] text-stone-400">{headerMeta}</span> : null}
      </div>
      {children}
    </div>
  );
}

function KvRow({
  label,
  value,
  numeric,
  mono,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-center gap-3 px-5 py-2.5 border-b border-stone-100 last:border-b-0 text-[13px]">
      <span className="text-stone-500">{label}</span>
      <span
        className={`text-stone-900 font-medium ${numeric ? 'tabular-nums' : ''} ${mono ? 'font-mono text-[12.5px]' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
  bold,
  muted,
}: {
  children: React.ReactNode;
  className?: string;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={`px-5 py-3 text-[13px] ${bold ? 'font-medium text-stone-900' : ''} ${muted ? 'text-stone-500' : 'text-stone-800'} ${className ?? ''}`}
    >
      {children}
    </td>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case 'doctor':
      return 'Mjeku';
    case 'receptionist':
      return 'Recepsioniste';
    case 'clinic_admin':
      return 'Administrator i klinikës';
    default:
      return role;
  }
}
