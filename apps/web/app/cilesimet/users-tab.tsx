'use client';

import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import {
  clinicClient,
  type ClinicRole,
  type ClinicUserRow,
  fileToBase64,
  roleLabel,
} from '@/lib/clinic-client';
import { formatRelativeAlbanian } from '@/lib/format-relative';
import { InfoTip, PaneHeader } from './section-card';

interface Props {
  users: ClinicUserRow[];
  onChange: (users: ClinicUserRow[]) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

export function UsersTab({ users, onChange, onToast }: Props) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | ClinicRole>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.email.toLowerCase().includes(q) ||
        u.firstName.toLowerCase().includes(q) ||
        u.lastName.toLowerCase().includes(q)
      );
    });
  }, [users, query, roleFilter]);

  const editingUser = users.find((u) => u.id === editingId) ?? null;

  function applyUser(updated: ClinicUserRow): void {
    onChange(users.map((u) => (u.id === updated.id ? updated : u)));
  }
  function appendUser(created: ClinicUserRow): void {
    onChange([created, ...users]);
  }

  return (
    <>
      <PaneHeader
        title="Përdoruesit"
        description="Stafi i klinikës që hyn në Klinika. Shtoni mjekë, infermiere ose admin shtesë."
      />

      <div className="flex items-center gap-3 mb-3.5">
        <div className="relative flex-1 max-w-[320px]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kërko sipas emrit ose email-it…"
            className="w-full h-10 pl-10 pr-3 rounded-md bg-white border border-stone-300 text-[13px] placeholder:text-stone-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            data-testid="users-search"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" aria-hidden>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3 3" strokeLinecap="round" />
            </svg>
          </span>
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as 'all' | ClinicRole)}
          className="h-10 px-3 rounded-md bg-white border border-stone-300 text-[13px] text-stone-800"
        >
          <option value="all">Të gjithë rolet</option>
          <option value="doctor">Mjek</option>
          <option value="receptionist">Infermierja</option>
          <option value="clinic_admin">Admin</option>
        </select>
        <div className="flex-1" />
        <Button onClick={() => setAddOpen(true)} data-testid="add-user">
          + Shto staf
        </Button>
      </div>

      <div className="bg-white border border-stone-200 rounded-xl shadow-xs overflow-hidden">
        <table className="w-full" data-testid="users-table">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3">
                Emri
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3">
                Roli
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3">
                Statusi
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3">
                Hyrja e fundit
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-stone-500 text-[13px] py-10">
                  Asnjë përdorues nuk përputhet.
                </td>
              </tr>
            ) : (
              filtered.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-stone-100 last:border-0 hover:bg-stone-50 cursor-pointer"
                  onClick={() => setEditingId(u.id)}
                  data-testid={`user-row-${u.email}`}
                >
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`h-7 w-7 rounded-full grid place-items-center text-[11px] font-semibold text-white ${
                          !u.isActive ? 'bg-stone-300' : u.role === 'doctor' ? 'bg-teal-700' : 'bg-stone-500'
                        }`}
                      >
                        {u.firstName.charAt(0)}
                        {u.lastName.charAt(0)}
                      </div>
                      <div>
                        <div
                          className={`text-[13px] font-medium ${
                            u.isActive ? 'text-stone-900' : 'text-stone-400'
                          }`}
                        >
                          {u.title ? `${u.title} ` : ''}
                          {u.firstName} {u.lastName}
                        </div>
                        <div className="text-[12px] font-mono text-stone-500">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[13px]">{roleLabel(u.role)}</td>
                  <td className="px-4 py-3.5">
                    {u.isActive ? (
                      <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        Aktiv
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        E çaktivizuar
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] text-stone-500 tabular-nums">
                    {formatRelativeAlbanian(u.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3.5 text-right text-stone-400">›</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5">
        <InfoTip>
          Të dhënat e përdoruesve të çaktivizuar ruhen për integritetin e audit log-ut. Përdoruesit
          nuk fshihen kurrë plotësisht. Të paktën një administrator duhet të mbetet aktiv.
        </InfoTip>
      </div>

      {addOpen ? (
        <AddUserModal
          onClose={() => setAddOpen(false)}
          onCreated={(user) => {
            appendUser(user);
            setAddOpen(false);
            onToast(`${user.firstName} ${user.lastName} u shtua · email me link u dërgua.`);
          }}
          onToast={onToast}
        />
      ) : null}

      {editingUser ? (
        <EditUserDrawer
          user={editingUser}
          onClose={() => setEditingId(null)}
          onUpdated={(user) => applyUser(user)}
          onToast={onToast}
        />
      ) : null}
    </>
  );
}

function AddUserModal({
  onClose,
  onCreated,
  onToast,
}: {
  onClose: () => void;
  onCreated: (user: ClinicUserRow) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ClinicRole>('receptionist');
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    setSubmitting(true);
    try {
      const out = await clinicClient.createUser({ firstName, lastName, email, role });
      onCreated(out.user);
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Shtimi dështoi.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-stone-900/40 grid place-items-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-modal w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-stone-200">
          <h2 className="text-[18px] font-semibold text-stone-900">Shto staf</h2>
          <p className="text-[12.5px] text-stone-500 mt-1">
            Personi do të marrë një email me fjalëkalim të përkohshëm. Mund ta ndryshojë në
            hyrjen e parë.
          </p>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Input
              placeholder="Emri"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              data-testid="new-user-first"
            />
            <Input
              placeholder="Mbiemri"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              data-testid="new-user-last"
            />
          </div>
          <Input
            type="email"
            placeholder="adresa@klinika.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="new-user-email"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ClinicRole)}
            className="h-10 px-3 rounded-md bg-white border border-stone-300 text-[13px]"
            data-testid="new-user-role"
          >
            <option value="doctor">Mjek</option>
            <option value="receptionist">Infermierja</option>
            <option value="clinic_admin">Admin · administrator i klinikës</option>
          </select>
          <InfoTip>
            Mjeku ka qasje në karta pacientësh dhe vizita. Infermierja menaxhon vetëm terminet.
            Admini menaxhon stafin dhe cilësimet.
          </InfoTip>
        </div>
        <div className="px-6 py-3.5 border-t border-stone-200 bg-stone-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Anulo
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !email || !firstName || !lastName}
            data-testid="new-user-submit"
          >
            {submitting ? 'Po dërgohet…' : 'Shto dhe dërgo email'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EditUserDrawer({
  user,
  onClose,
  onUpdated,
  onToast,
}: {
  user: ClinicUserRow;
  onClose: () => void;
  onUpdated: (user: ClinicUserRow) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<ClinicRole>(user.role);
  const [title, setTitle] = useState(user.title ?? '');
  const [credential, setCredential] = useState(user.credential ?? '');
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<'deactivate' | 'reset' | 'signature' | null>(null);
  const signatureInput = useRef<HTMLInputElement>(null);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const out = await clinicClient.updateUser(user.id, {
        email,
        firstName,
        lastName,
        role,
        title: title || undefined,
        credential: credential || undefined,
      });
      onUpdated(out.user);
      onToast('Ndryshimet u ruajtën.');
      onClose();
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Ruajtja dështoi.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(): Promise<void> {
    setBusyAction('deactivate');
    try {
      const out = await clinicClient.setUserActive(user.id, !user.isActive);
      onUpdated(out.user);
      onToast(out.user.isActive ? 'Përdoruesi u aktivizua.' : 'Përdoruesi u çaktivizua.');
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Veprimi dështoi.', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function resetPassword(): Promise<void> {
    setBusyAction('reset');
    try {
      await clinicClient.sendUserPasswordReset(user.id);
      onToast('Link i resetit u dërgua.');
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Dërgimi dështoi.', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  async function uploadSig(file: File): Promise<void> {
    if (file.size > 1024 * 1024) {
      onToast('Nënshkrimi nuk mund të kalojë 1 MB.', 'error');
      return;
    }
    if (file.type !== 'image/png') {
      onToast('Vetëm PNG.', 'error');
      return;
    }
    setBusyAction('signature');
    try {
      const dataBase64 = await fileToBase64(file);
      await clinicClient.uploadUserSignature(user.id, { contentType: 'image/png', dataBase64 });
      onUpdated({ ...user, hasSignature: true });
      onToast('Nënshkrimi u ruajt.');
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Ngarkimi dështoi.', 'error');
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/35" onClick={onClose}>
      <div
        className="absolute right-0 top-0 bottom-0 w-[440px] max-w-[calc(100vw-60px)] bg-white shadow-modal flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4.5 border-b border-stone-200 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-stone-900">
              {user.firstName} {user.lastName}
            </h2>
            <div className="text-[12px] text-stone-500 mt-0.5">
              Krijuar {new Date(user.createdAt).toLocaleDateString('sq-AL')} ·{' '}
              {user.lastLoginAt ? `Hyrja e fundit ${formatRelativeAlbanian(user.lastLoginAt)}` : 'Asnjë hyrje'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center text-stone-500 hover:bg-stone-100 rounded-md"
            aria-label="Mbyll"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">
                Emri
              </label>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">
                Mbiemri
              </label>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">
              Email
            </label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">
              Roli
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as ClinicRole)}
              className="block w-full h-10 px-3 rounded-md bg-white border border-stone-300 text-[13px]"
            >
              <option value="doctor">Mjek</option>
              <option value="receptionist">Infermierja</option>
              <option value="clinic_admin">Admin</option>
            </select>
          </div>

          {role === 'doctor' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">
                    Titulli
                  </label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Dr." />
                </div>
                <div>
                  <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500">
                    Profesioni
                  </label>
                  <Input
                    value={credential}
                    onChange={(e) => setCredential(e.target.value)}
                    placeholder="Pediatër"
                  />
                </div>
              </div>
              <div className="rounded-md bg-stone-50 border border-stone-200 p-3">
                <div className="text-[13px] font-semibold text-stone-900">
                  Nënshkrimi i mjekut
                </div>
                <div className="text-[12px] text-stone-500 mt-0.5 mb-2">
                  Ruhet i koduar · përdoret në vërtetime dhe receta.
                </div>
                <input
                  ref={signatureInput}
                  type="file"
                  accept="image/png"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void uploadSig(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => signatureInput.current?.click()}
                  disabled={busyAction === 'signature'}
                >
                  {user.hasSignature ? 'Ndrysho nënshkrimin' : 'Ngarko nënshkrimin'}
                </Button>
              </div>
            </>
          ) : null}

          <div className="rounded-md bg-stone-50 border border-stone-200 p-3">
            <div className="text-[13px] font-semibold text-stone-900">Reset i fjalëkalimit</div>
            <div className="text-[12px] text-stone-500 mt-0.5 mb-2">
              Përdoruesit do t&apos;i dërgohet një email me link të ri. Linku skadon në 60 minuta.
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={resetPassword}
              disabled={busyAction === 'reset'}
              data-testid="user-password-reset"
            >
              {busyAction === 'reset' ? 'Po dërgohet…' : 'Dërgo link reseti'}
            </Button>
          </div>

          <div className="rounded-md bg-stone-50 border border-stone-200 p-3">
            <div className="text-[13px] font-semibold text-stone-900">
              {user.isActive ? 'Çaktivizo përdoruesin' : 'Aktivizo përdoruesin'}
            </div>
            <div className="text-[12px] text-stone-500 mt-0.5 mb-2">
              {user.isActive
                ? 'Nuk do të mund të identifikohet, por të dhënat dhe historiku ruhen.'
                : 'Përdoruesi do të mund të identifikohet përsëri.'}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={toggleActive}
              disabled={busyAction === 'deactivate'}
              data-testid="user-toggle-active"
            >
              {busyAction === 'deactivate'
                ? 'Po procesohet…'
                : user.isActive
                  ? 'Çaktivizo'
                  : 'Aktivizo'}
            </Button>
          </div>
        </div>
        <div className="px-6 py-3.5 border-t border-stone-200 bg-stone-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Anulo
          </Button>
          <Button onClick={save} disabled={saving} data-testid="user-save">
            {saving ? 'Po ruhet…' : 'Ruaj'}
          </Button>
        </div>
      </div>
    </div>
  );
}
