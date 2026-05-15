import { apiFetch } from './api';

// ---------------------------------------------------------------------------
// Wire shapes — keep aligned with apps/api/src/modules/clinic-settings/clinic-settings.dto.ts
// ---------------------------------------------------------------------------

export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type HoursDay =
  | { open: true; start: string; end: string }
  | { open: false };

export interface HoursConfig {
  timezone: 'Europe/Belgrade';
  days: Record<DayKey, HoursDay>;
  durations: number[];
  defaultDuration: number;
}

export interface PaymentCode {
  label: string;
  amountCents: number;
}

export type PaymentCodes = Record<string, PaymentCode>;

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  fromName: string;
  fromAddress: string;
  passwordSet: boolean;
}

export interface ClinicSettings {
  general: {
    name: string;
    shortName: string;
    subdomain: string;
    address: string;
    city: string;
    phones: string[];
    email: string;
    /** Walk-in default duration (minutes). Range 5–60, snapped to 5. */
    walkinDurationMinutes: number;
  };
  branding: {
    hasLogo: boolean;
    logoContentType: 'image/png' | 'image/svg+xml' | null;
    hasSignature: boolean;
  };
  hours: HoursConfig;
  paymentCodes: PaymentCodes;
  email: {
    mode: 'default' | 'smtp';
    smtp: SmtpConfig | null;
  };
}

export type ClinicRole = 'doctor' | 'receptionist' | 'clinic_admin';

export interface ClinicUserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: ClinicRole[];
  title: string | null;
  credential: string | null;
  hasSignature: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: string;
  timestamp: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  changes: Array<{ field: string; old: unknown; new: unknown }> | null;
  ipAddress: string | null;
}

export interface AuditQuery {
  from?: string;
  to?: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  limit?: number;
  cursor?: string;
}

export type SmtpUpdate =
  | { mode: 'default' }
  | {
      mode: 'smtp';
      host: string;
      port: number;
      username: string;
      password?: string;
      fromName: string;
      fromAddress: string;
    };

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export const clinicClient = {
  getSettings: () => apiFetch<ClinicSettings>('/api/clinic/settings'),
  updateGeneral: (input: Omit<ClinicSettings['general'], 'subdomain'>) =>
    apiFetch<ClinicSettings>('/api/clinic/settings/general', {
      method: 'PUT',
      json: input,
    }),
  updateHours: (input: HoursConfig) =>
    apiFetch<ClinicSettings>('/api/clinic/settings/hours', { method: 'PUT', json: input }),
  updatePaymentCodes: (input: PaymentCodes) =>
    apiFetch<ClinicSettings>('/api/clinic/settings/payment-codes', {
      method: 'PUT',
      json: input,
    }),
  updateEmail: (input: SmtpUpdate) =>
    apiFetch<ClinicSettings>('/api/clinic/settings/email', { method: 'PUT', json: input }),
  testEmail: (input: SmtpUpdate & { toEmail: string }) =>
    apiFetch<{ ok: boolean; detail: string; reason?: string }>(
      '/api/clinic/settings/email/test',
      { method: 'POST', json: input },
    ),
  uploadLogo: (input: { contentType: 'image/png' | 'image/svg+xml'; dataBase64: string }) =>
    apiFetch<ClinicSettings>('/api/clinic/settings/branding/logo', {
      method: 'POST',
      json: input,
    }),
  removeLogo: () =>
    apiFetch<ClinicSettings>('/api/clinic/settings/branding/logo', { method: 'DELETE' }),
  uploadSignature: (input: { contentType: 'image/png'; dataBase64: string }) =>
    apiFetch<ClinicSettings>('/api/clinic/settings/branding/signature', {
      method: 'POST',
      json: input,
    }),
  removeSignature: () =>
    apiFetch<ClinicSettings>('/api/clinic/settings/branding/signature', { method: 'DELETE' }),

  // Users
  listUsers: () => apiFetch<{ users: ClinicUserRow[] }>('/api/clinic/users'),
  createUser: (input: {
    email: string;
    firstName: string;
    lastName: string;
    roles: ClinicRole[];
    title?: string;
    credential?: string;
  }) => apiFetch<{ user: ClinicUserRow }>('/api/clinic/users', { method: 'POST', json: input }),
  updateUser: (
    id: string,
    input: {
      email: string;
      firstName: string;
      lastName: string;
      roles: ClinicRole[];
      title?: string;
      credential?: string;
    },
  ) =>
    apiFetch<{ user: ClinicUserRow }>(`/api/clinic/users/${id}`, {
      method: 'PUT',
      json: input,
    }),
  setUserActive: (id: string, isActive: boolean) =>
    apiFetch<{ user: ClinicUserRow }>(`/api/clinic/users/${id}/active`, {
      method: 'POST',
      json: { isActive },
    }),
  sendUserPasswordReset: (id: string) =>
    apiFetch<{ status: 'ok' }>(`/api/clinic/users/${id}/password-reset`, { method: 'POST' }),
  uploadUserSignature: (
    id: string,
    input: { contentType: 'image/png'; dataBase64: string },
  ) =>
    apiFetch<{ status: 'ok' }>(`/api/clinic/users/${id}/signature`, {
      method: 'POST',
      json: input,
    }),

  // Audit
  queryAudit: (q: AuditQuery) => {
    const params = new URLSearchParams();
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    if (q.userId) params.set('userId', q.userId);
    if (q.action) params.set('action', q.action);
    if (q.resourceType) params.set('resourceType', q.resourceType);
    if (q.limit !== undefined) params.set('limit', String(q.limit));
    if (q.cursor) params.set('cursor', q.cursor);
    const qs = params.toString();
    return apiFetch<{ rows: AuditRow[]; nextCursor: string | null }>(
      `/api/clinic/audit${qs ? `?${qs}` : ''}`,
    );
  },
  exportAuditUrl: (q: AuditQuery) => {
    const params = new URLSearchParams();
    if (q.from) params.set('from', q.from);
    if (q.to) params.set('to', q.to);
    if (q.userId) params.set('userId', q.userId);
    if (q.action) params.set('action', q.action);
    if (q.resourceType) params.set('resourceType', q.resourceType);
    const qs = params.toString();
    return `/api/clinic/audit/export.csv${qs ? `?${qs}` : ''}`;
  },
};

export function formatEuro(amountCents: number): string {
  return `€ ${(amountCents / 100).toLocaleString('sq-AL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

// Canonical Albanian role labels now live in
// `apps/web/lib/role-labels.ts`. Re-export so existing call-sites
// keep compiling — new code should import from `./role-labels`
// directly for clarity.
export { roleLabel } from './role-labels';

export const DAY_LABELS: Record<DayKey, string> = {
  mon: 'E hënë',
  tue: 'E martë',
  wed: 'E mërkurë',
  thu: 'E enjte',
  fri: 'E premte',
  sat: 'E shtunë',
  sun: 'E diel',
};

export const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
