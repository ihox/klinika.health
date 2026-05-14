'use client';

import { useMemo, useRef, useState } from 'react';

import { RoleChip } from '@/components/role-chip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import {
  clinicClient,
  type ClinicRole,
  type ClinicUserRow,
  fileToBase64,
} from '@/lib/clinic-client';
import { formatRelativeAlbanian } from '@/lib/format-relative';
import { ROLE_DISPLAY_ORDER, roleLabel } from '@/lib/role-labels';
import { InfoTip, PaneHeader } from './section-card';

interface Props {
  users: ClinicUserRow[];
  onChange: (users: ClinicUserRow[]) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

/**
 * Short Albanian description for each role checkbox — pulled from the
 * design reference (components/user-create-modal.html) so the
 * descriptive copy matches what the prototype shows.
 */
const ROLE_DESCRIPTION: Record<ClinicRole, string> = {
  doctor: 'Karta, vizita, recetë',
  receptionist: 'Kalendari, terminet',
  clinic_admin: 'Stafi, cilësimet, audit',
};

export function UsersTab({ users, onChange, onToast }: Props) {
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | ClinicRole>('all');
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      // Multi-role filter: match if ANY of the user's roles equals
      // the filter selection.
      if (roleFilter !== 'all' && !u.roles.includes(roleFilter)) return false;
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
        description="Stafi i klinikës që hyn në Klinika. Shtoni mjekë, recepsioniste ose admin shtesë."
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
          {ROLE_DISPLAY_ORDER.map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
        <div className="flex-1" />
        <Button onClick={() => setAddOpen(true)} data-testid="add-user">
          + Shto përdorues
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
                Rolet
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
                      <UserAvatar user={u} />
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
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap gap-1" data-testid={`user-roles-${u.email}`}>
                      {orderedRoles(u.roles).map((r) => (
                        <RoleChip key={r} role={r} size="sm" />
                      ))}
                    </div>
                  </td>
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

function UserAvatar({ user }: { user: ClinicUserRow }): React.ReactElement {
  // Avatar background mirrors the dominant role (matching the user
  // menu's avatar). Inactive users always render in muted stone.
  const bg = !user.isActive
    ? 'bg-stone-300'
    : user.roles.includes('doctor')
      ? 'bg-indigo-700'
      : user.roles.includes('clinic_admin')
        ? 'bg-slate-700'
        : user.roles.includes('receptionist')
          ? 'bg-violet-700'
          : 'bg-stone-500';
  return (
    <div
      className={`h-7 w-7 rounded-full grid place-items-center text-[11px] font-semibold text-white ${bg}`}
    >
      {user.firstName.charAt(0)}
      {user.lastName.charAt(0)}
    </div>
  );
}

function orderedRoles(roles: readonly ClinicRole[]): ClinicRole[] {
  const set = new Set(roles);
  return ROLE_DISPLAY_ORDER.filter((r) => set.has(r));
}

// ===========================================================================
// Add modal
// ===========================================================================

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
  const [roles, setRoles] = useState<Set<ClinicRole>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const rolesArray = useMemo(() => orderedRoles(Array.from(roles)), [roles]);
  const canSubmit =
    !submitting &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    email.trim().length > 0 &&
    rolesArray.length > 0;

  function toggleRole(role: ClinicRole): void {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  async function submit(): Promise<void> {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const out = await clinicClient.createUser({
        firstName,
        lastName,
        email,
        roles: rolesArray,
      });
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
      aria-labelledby="add-user-title"
      className="fixed inset-0 z-50 bg-stone-900/40 grid place-items-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-modal w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-stone-200">
          <h2 id="add-user-title" className="text-[17px] font-semibold text-stone-900">
            Shto përdorues të ri
          </h2>
          <p className="text-[12.5px] text-stone-500 mt-1">
            Përdoruesi do të marrë një email për të vendosur fjalëkalimin.
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
          <RolePicker
            selected={roles}
            onToggle={toggleRole}
            requiredHint
            testIdPrefix="new-user-role"
          />
          <InfoTip>
            Përdoruesi do të marrë një email për të vendosur fjalëkalimin.
          </InfoTip>
        </div>
        <div className="px-6 py-3.5 border-t border-stone-200 bg-stone-50 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Anulo
          </Button>
          <Button onClick={submit} disabled={!canSubmit} data-testid="new-user-submit">
            {submitting ? 'Po dërgohet…' : 'Shto përdoruesin'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Edit drawer
// ===========================================================================

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
  const [roles, setRoles] = useState<Set<ClinicRole>>(new Set(user.roles));
  const [title, setTitle] = useState(user.title ?? '');
  const [credential, setCredential] = useState(user.credential ?? '');
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState<'deactivate' | 'reset' | 'signature' | null>(null);
  const signatureInput = useRef<HTMLInputElement>(null);

  const rolesArray = useMemo(() => orderedRoles(Array.from(roles)), [roles]);
  const isDoctor = roles.has('doctor');
  const canSave = !saving && rolesArray.length > 0;

  function toggleRole(role: ClinicRole): void {
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    try {
      const out = await clinicClient.updateUser(user.id, {
        email,
        firstName,
        lastName,
        roles: rolesArray,
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
        role="dialog"
        aria-modal="true"
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

          <RolePicker
            selected={roles}
            onToggle={toggleRole}
            requiredHint
            testIdPrefix="edit-user-role"
          />

          {isDoctor ? (
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
          <Button onClick={save} disabled={!canSave} data-testid="user-save">
            {saving ? 'Po ruhet…' : 'Ruaj ndryshimet'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Role picker (shared between add modal + edit drawer)
// ===========================================================================

interface RolePickerProps {
  selected: Set<ClinicRole>;
  onToggle: (role: ClinicRole) => void;
  requiredHint?: boolean;
  testIdPrefix: string;
}

function RolePicker({ selected, onToggle, requiredHint, testIdPrefix }: RolePickerProps) {
  const noneSelected = selected.size === 0;
  return (
    <div>
      <label className="text-[12px] font-medium uppercase tracking-wide text-stone-500 flex items-center gap-2">
        Rolet
        {requiredHint ? (
          <span className="normal-case text-[11px] font-normal text-stone-400">
            — së paku një
          </span>
        ) : null}
      </label>
      <div className="mt-1.5 flex flex-col gap-2">
        {ROLE_DISPLAY_ORDER.map((role) => {
          const checked = selected.has(role);
          return (
            <label
              key={role}
              className={[
                'flex items-center gap-3 px-3 py-2.5 border rounded-md cursor-pointer transition-colors',
                checked
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-stone-300 bg-white hover:bg-stone-50',
              ].join(' ')}
            >
              <input
                type="checkbox"
                className="h-4 w-4 accent-teal-600"
                checked={checked}
                onChange={() => onToggle(role)}
                data-testid={`${testIdPrefix}-${role}`}
              />
              <span className="flex items-center gap-2.5 flex-1 min-w-0">
                <RoleChip role={role} />
                <span className="text-[12px] text-stone-500 truncate">
                  {ROLE_DESCRIPTION[role]}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {noneSelected ? (
        <div
          className="mt-2 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900"
          role="alert"
          data-testid={`${testIdPrefix}-validation`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.5M8 11v.01" />
          </svg>
          Përdoruesi duhet të ketë së paku një rol.
        </div>
      ) : null}
    </div>
  );
}
