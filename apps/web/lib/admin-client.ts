import { apiFetch } from './api';

export interface AdminLoginInput {
  email: string;
  password: string;
}

export interface AdminLoginResponse {
  status: 'mfa_required' | 'authenticated';
  pendingSessionId?: string;
  maskedEmail?: string;
}

export interface AdminProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface TenantSummary {
  id: string;
  name: string;
  shortName: string;
  subdomain: string;
  city: string;
  status: 'active' | 'suspended';
  userCount: number;
  patientCount: number;
  visitCount: number;
  createdAt: string;
  lastActivityAt: string | null;
}

export interface TenantUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface TenantTelemetry {
  lastHeartbeatAt: string | null;
  appHealthy: boolean | null;
  dbHealthy: boolean | null;
  orthancHealthy: boolean | null;
  cpuPercent: number | null;
  ramPercent: number | null;
  diskPercent: number | null;
  lastBackupAt: string | null;
  queueDepth: number | null;
  errorRate5xx: number | null;
}

export interface TenantAuditEntry {
  id: string;
  action: string;
  resourceType: string;
  timestamp: string;
  actorEmail: string | null;
}

export interface TenantDetail extends TenantSummary {
  address: string;
  phones: string[];
  contactEmail: string;
  users: TenantUser[];
  telemetry: TenantTelemetry;
  recentAudit: TenantAuditEntry[];
}

export interface CreateTenantInput {
  name: string;
  shortName: string;
  subdomain: string;
  city: string;
  address: string;
  phones: string[];
  contactEmail: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
}

export interface SubdomainAvailability {
  available: boolean;
  subdomain: string;
  reason?: string;
}

export interface PlatformAdminSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CreatePlatformAdminInput {
  email: string;
  firstName: string;
  lastName: string;
}

export interface PlatformHealthSnapshot {
  generatedAt: string;
  tenants: { total: number; active: number; suspended: number };
  users: { total: number; activeToday: number };
  patients: { total: number; visitsThisMonth: number };
  systems: Array<{
    key: string;
    label: string;
    status: 'ok' | 'warning' | 'critical';
    detail: string;
    lastCheckedAt: string | null;
  }>;
  recentAlerts: Array<{
    id: string;
    tenantId: string;
    severity: 'critical' | 'warning';
    kind: string;
    message: string;
    createdAt: string;
    notifiedAt: string | null;
  }>;
}

export const adminClient = {
  login: (input: AdminLoginInput) =>
    apiFetch<AdminLoginResponse>('/api/admin/auth/login', { method: 'POST', json: input }),
  mfaVerify: (input: { pendingSessionId: string; code: string }) =>
    apiFetch<{ status: 'authenticated' }>('/api/admin/auth/mfa/verify', {
      method: 'POST',
      json: input,
    }),
  mfaResend: (input: { pendingSessionId: string }) =>
    apiFetch<{ maskedEmail: string }>('/api/admin/auth/mfa/resend', {
      method: 'POST',
      json: input,
    }),
  me: () => apiFetch<{ admin: AdminProfile }>('/api/admin/auth/me', { method: 'GET' }),
  logout: () => apiFetch<{ status: 'ok' }>('/api/admin/auth/logout', { method: 'POST' }),

  listTenants: () =>
    apiFetch<{ tenants: TenantSummary[] }>('/api/admin/tenants', { method: 'GET' }),
  getTenant: (id: string) =>
    apiFetch<{ tenant: TenantDetail }>(`/api/admin/tenants/${id}`, { method: 'GET' }),
  createTenant: (input: CreateTenantInput) =>
    apiFetch<{ tenant: TenantDetail }>('/api/admin/tenants', { method: 'POST', json: input }),
  suspendTenant: (id: string, note?: string) =>
    apiFetch<{ tenant: TenantDetail }>(`/api/admin/tenants/${id}/suspend`, {
      method: 'POST',
      json: { note: note ?? null },
    }),
  activateTenant: (id: string) =>
    apiFetch<{ tenant: TenantDetail }>(`/api/admin/tenants/${id}/activate`, { method: 'POST' }),
  checkSubdomain: (subdomain: string) =>
    apiFetch<SubdomainAvailability>(
      `/api/admin/tenants/subdomain-availability?subdomain=${encodeURIComponent(subdomain)}`,
      { method: 'GET' },
    ),

  listPlatformAdmins: () =>
    apiFetch<{ admins: PlatformAdminSummary[] }>('/api/admin/platform-admins', { method: 'GET' }),
  createPlatformAdmin: (input: CreatePlatformAdminInput) =>
    apiFetch<{ admin: PlatformAdminSummary }>('/api/admin/platform-admins', {
      method: 'POST',
      json: input,
    }),

  healthSnapshot: () =>
    apiFetch<PlatformHealthSnapshot>('/api/admin/health', { method: 'GET' }),
};
