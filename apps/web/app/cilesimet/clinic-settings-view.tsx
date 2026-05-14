'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/lib/api';
import {
  clinicClient,
  type ClinicSettings,
  type ClinicUserRow,
} from '@/lib/clinic-client';
import { AuditTab } from './audit-tab';
import { EmailTab } from './email-tab';
import { GeneralTab } from './general-tab';
import { HoursTab } from './hours-tab';
import { PaymentsTab } from './payments-tab';
import { Toast, useToast } from './toast';
import { UsersTab } from './users-tab';

type TabKey = 'general' | 'hours' | 'users' | 'payments' | 'email' | 'audit';

const TABS: ReadonlyArray<{ key: TabKey; label: string; group: 'clinic' | 'system' }> = [
  { key: 'general', label: 'Përgjithshme', group: 'clinic' },
  { key: 'hours', label: 'Orari dhe terminet', group: 'clinic' },
  { key: 'users', label: 'Përdoruesit', group: 'clinic' },
  { key: 'payments', label: 'Pagesa', group: 'clinic' },
  { key: 'email', label: 'Email', group: 'system' },
  { key: 'audit', label: 'Auditimi', group: 'system' },
];

export function ClinicSettingsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabKey) ?? 'general';

  const [settings, setSettings] = useState<ClinicSettings | null>(null);
  const [users, setUsers] = useState<ClinicUserRow[] | null>(null);
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, u] = await Promise.all([clinicClient.getSettings(), clinicClient.listUsers()]);
      setSettings(s);
      setUsers(u.users);
    } catch (err: unknown) {
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

  useEffect(() => {
    // Mirror tab to URL for deep-links from the sidebar.
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'general') params.delete('tab');
    else params.set('tab', tab);
    const qs = params.toString();
    router.replace(`/cilesimet${qs ? `?${qs}` : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onSettingsChange = useCallback((next: ClinicSettings) => {
    setSettings(next);
  }, []);

  const usersCount = useMemo(() => users?.filter((u) => u.isActive).length ?? 0, [users]);

  if (loading) {
    return (
      <main className="min-h-screen bg-stone-50 grid place-items-center text-stone-500">
        Po ngarkohet…
      </main>
    );
  }
  if (error || !settings || !users) {
    return (
      <main className="min-h-screen bg-stone-50 grid place-items-center">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          {error ?? 'Nuk u ngarkuan cilësimet.'}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 pb-16">
      <div className="max-w-[1280px] mx-auto px-8 pt-6">
        <header className="mb-4">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-stone-900">
            Cilësimet e klinikës
          </h1>
          <div className="mt-1 text-[13px] text-stone-500 flex items-center gap-2.5">
            <span className="font-medium text-stone-800">{settings.general.shortName}</span>
            <span className="text-stone-300">·</span>
            <span className="font-mono">{settings.general.subdomain}.klinika.health</span>
            <span className="text-stone-300">·</span>
            <span>{settings.general.name}</span>
          </div>
        </header>

        <div className="grid grid-cols-[232px_1fr] gap-8 items-start">
          <aside className="sticky top-6 flex flex-col gap-0.5" data-testid="settings-sidebar">
            <SectionLabel>Klinika</SectionLabel>
            {TABS.filter((t) => t.group === 'clinic').map((t) => (
              <SidebarItem
                key={t.key}
                active={tab === t.key}
                onClick={() => setTab(t.key)}
                badge={t.key === 'users' ? usersCount : undefined}
              >
                {t.label}
              </SidebarItem>
            ))}
            <SectionLabel>Sistemi</SectionLabel>
            {TABS.filter((t) => t.group === 'system').map((t) => (
              <SidebarItem
                key={t.key}
                active={tab === t.key}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </SidebarItem>
            ))}
          </aside>

          <section data-testid={`pane-${tab}`}>
            {tab === 'general' ? (
              <GeneralTab
                settings={settings}
                onChange={onSettingsChange}
                onToast={showToast}
              />
            ) : null}
            {tab === 'hours' ? (
              <HoursTab settings={settings} onChange={onSettingsChange} onToast={showToast} />
            ) : null}
            {tab === 'users' ? (
              <UsersTab users={users} onChange={setUsers} onToast={showToast} />
            ) : null}
            {tab === 'payments' ? (
              <PaymentsTab
                settings={settings}
                onChange={onSettingsChange}
                onToast={showToast}
              />
            ) : null}
            {tab === 'email' ? (
              <EmailTab settings={settings} onChange={onSettingsChange} onToast={showToast} />
            ) : null}
            {tab === 'audit' ? <AuditTab users={users} /> : null}
          </section>
        </div>
      </div>
      <Toast toast={toast} />
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] uppercase tracking-[0.08em] text-stone-400 font-semibold px-3 pt-3.5 pb-1.5 first:pt-0">
      {children}
    </div>
  );
}

function SidebarItem({
  active,
  onClick,
  children,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between px-3 py-2 rounded-md text-[13px] font-medium transition-colors text-left ${
        active
          ? 'bg-teal-50 text-teal-800'
          : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'
      }`}
    >
      <span>{children}</span>
      {badge !== undefined ? (
        <span
          className={`text-[11px] font-medium rounded-full px-1.5 tabular-nums ${
            active ? 'bg-white text-teal-800' : 'bg-stone-100 text-stone-400'
          }`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}
