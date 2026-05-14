'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import {
  clinicClient,
  type AuditQuery,
  type AuditRow,
  type ClinicUserRow,
} from '@/lib/clinic-client';
import { PaneHeader } from './section-card';

interface Props {
  users: ClinicUserRow[];
}

const RANGE_OPTIONS = [
  { key: '7d', label: '7 ditët e fundit' },
  { key: '30d', label: '30 ditët e fundit' },
  { key: 'today', label: 'Sot' },
  { key: 'all', label: 'Të gjitha' },
] as const;
type RangeKey = (typeof RANGE_OPTIONS)[number]['key'];

const ACTION_PREFIXES: Array<{ key: string; label: string }> = [
  { key: '', label: 'Të gjitha veprimet' },
  { key: 'auth.', label: 'Hyrje & sesionet' },
  { key: 'settings.', label: 'Cilësimet' },
  { key: 'visit.', label: 'Vizitat' },
  { key: 'appointment.', label: 'Terminet' },
];

export function AuditTab({ users }: Props) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState<RangeKey>('7d');
  const [actionPrefix, setActionPrefix] = useState<string>('');
  const [userFilter, setUserFilter] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const filters = useMemo<AuditQuery>(() => {
    const out: AuditQuery = { limit: 50 };
    const now = new Date();
    if (range === '7d') out.from = isoDaysAgo(7);
    else if (range === '30d') out.from = isoDaysAgo(30);
    else if (range === 'today') out.from = new Date(now.toDateString()).toISOString();
    if (userFilter) out.userId = userFilter;
    return out;
  }, [range, userFilter]);

  const load = useCallback(
    async (cursor?: string): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const out = await clinicClient.queryAudit({ ...filters, cursor });
        const filtered = actionPrefix
          ? out.rows.filter((r) => r.action.startsWith(actionPrefix))
          : out.rows;
        if (cursor) {
          setRows((prev) => [...prev, ...filtered]);
        } else {
          setRows(filtered);
        }
        setNextCursor(out.nextCursor);
      } catch (err: unknown) {
        setError(err instanceof ApiError ? err.message : 'Ngarkimi dështoi.');
      } finally {
        setLoading(false);
      }
    },
    [filters, actionPrefix],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const usersById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  function toggleExpanded(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function downloadCsv(): void {
    const url = clinicClient.exportAuditUrl(filters);
    // Direct navigation triggers the browser to download with the
    // Content-Disposition filename from the API.
    if (typeof window !== 'undefined') {
      const a = document.createElement('a');
      a.href = url;
      a.click();
    }
  }

  return (
    <>
      <PaneHeader
        title="Auditimi"
        description="Të gjitha ndryshimet e të dhënave klinike dhe veprimet e përdoruesve. Mbahen për 7 vjet sipas rregullores."
      />

      <div className="flex items-center gap-2.5 mb-3.5 flex-wrap">
        <select
          value={actionPrefix}
          onChange={(e) => setActionPrefix(e.target.value)}
          className="h-9 px-3 rounded-md bg-white border border-stone-300 text-[13px]"
          data-testid="audit-action"
        >
          {ACTION_PREFIXES.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
        <select
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          className="h-9 px-3 rounded-md bg-white border border-stone-300 text-[13px]"
          data-testid="audit-user"
        >
          <option value="">Të gjithë përdoruesit</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.title ? `${u.title} ` : ''}
              {u.firstName} {u.lastName}
            </option>
          ))}
        </select>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value as RangeKey)}
          className="h-9 px-3 rounded-md bg-white border border-stone-300 text-[13px]"
          data-testid="audit-range"
        >
          {RANGE_OPTIONS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={downloadCsv} data-testid="audit-export">
          Eksporto CSV
        </Button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-xs overflow-hidden">
        {error ? (
          <div className="p-4 text-[13px] text-amber-900 bg-amber-50 border-b border-amber-200">
            {error}
          </div>
        ) : null}
        {rows.length === 0 && !loading ? (
          <div className="p-10 text-center text-stone-500 text-[13px]">
            Asnjë ngjarje nuk përputhet.
          </div>
        ) : null}
        {rows.map((r) => {
          const isOpen = expanded.has(r.id);
          const user = usersById.get(r.userId);
          const displayName = user
            ? `${user.title ? `${user.title} ` : ''}${user.firstName} ${user.lastName}`
            : (r.userName ?? r.userEmail ?? '—');
          return (
            <div key={r.id} className="border-b border-stone-100 last:border-0">
              <div
                className={`grid grid-cols-[130px_200px_1fr_24px] gap-3 px-4.5 py-3 items-center cursor-pointer transition-colors ${
                  isOpen ? 'bg-stone-50' : 'hover:bg-stone-50'
                }`}
                onClick={() => toggleExpanded(r.id)}
              >
                <div className="font-mono text-[12.5px] text-stone-500 tabular-nums">
                  {formatAuditTime(r.timestamp)}
                </div>
                <div className="text-[13px] font-medium text-stone-800">{displayName}</div>
                <div className="text-[13px] text-stone-500">
                  <span className="text-stone-800 font-medium">{describeAction(r.action)}</span>
                  {r.resourceType ? (
                    <span className="text-stone-400"> · {r.resourceType}</span>
                  ) : null}
                </div>
                <div
                  className={`text-stone-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  aria-hidden
                >
                  ›
                </div>
              </div>
              {isOpen && r.changes ? (
                <div className="bg-stone-50 px-4.5 pb-3.5 pl-[180px]">
                  {r.changes.map((c, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[140px_1fr_1fr] gap-3 text-[12.5px] py-2 border-t border-dashed border-stone-200 first:border-0"
                    >
                      <div className="text-stone-500">{c.field}</div>
                      <div className="text-stone-500 line-through">{formatValue(c.old)}</div>
                      <div className="text-stone-900 font-medium">{formatValue(c.new)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {isOpen && !r.changes ? (
                <div className="bg-stone-50 px-4.5 pb-3 pl-[180px] text-[12.5px] text-stone-500">
                  Pa diff për të shfaqur (veprim leximi ose ngjarje sistemi).
                </div>
              ) : null}
            </div>
          );
        })}
        <div className="px-4 py-3 bg-stone-50 border-t border-stone-200 text-center text-[13px] text-stone-500">
          {nextCursor ? (
            <button
              type="button"
              onClick={() => void load(nextCursor)}
              className="text-teal-700 hover:underline font-medium"
            >
              {loading ? 'Po ngarkohet…' : 'Shfaq më shumë'}
            </button>
          ) : (
            <span>{loading ? 'Po ngarkohet…' : `${rows.length} ngjarje · fundi i listës`}</span>
          )}
        </div>
      </div>
    </>
  );
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}.${month} · ${hours}:${minutes}`;
}

function describeAction(action: string): string {
  // Map a few common actions to friendly Albanian strings; fall back
  // to the action token for unfamiliar values.
  const map: Record<string, string> = {
    'auth.login.success': 'Hyrje në sistem',
    'auth.login.failed': 'Hyrje e dështuar',
    'auth.logout': 'Dalje nga sistemi',
    'auth.mfa.sent': 'Kod MFA u dërgua',
    'auth.mfa.verified': 'Kod MFA u verifikua',
    'auth.password.changed': 'Fjalëkalimi u ndryshua',
    'auth.sessions.revoked': 'Sesion u revokua',
    'auth.device.revoked': 'Pajisje e besuar u revokua',
    'auth.device.trusted': 'Pajisje u shtua si e besuar',
    'settings.general.updated': 'Cilësimet bazë u ndryshuan',
    'settings.hours.updated': 'Orari u ndryshua',
    'settings.payment_codes.updated': 'Kodet e pagesave u ndryshuan',
    'settings.email.updated': 'SMTP-ja u ndryshua',
    'settings.email.tested': 'SMTP-ja u testua',
    'settings.email.test_failed': 'Testimi i SMTP-së dështoi',
    'settings.branding.logo_updated': 'Logo u ndryshua',
    'settings.branding.logo_removed': 'Logo u hoq',
    'settings.branding.signature_updated': 'Nënshkrimi u ndryshua',
    'settings.branding.signature_removed': 'Nënshkrimi u hoq',
    'settings.user.created': 'Përdorues u shtua',
    'settings.user.updated': 'Përdorues u modifikua',
    'settings.user.activated': 'Përdorues u aktivizua',
    'settings.user.deactivated': 'Përdorues u çaktivizua',
    'settings.user.password_reset_requested': 'Reset fjalëkalimi u dërgua',
    'settings.user.signature_updated': 'Nënshkrim mjeku u përditësua',
  };
  return map[action] ?? action;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return v.toLocaleString('sq-AL');
  if (Array.isArray(v)) return v.map(formatValue).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
