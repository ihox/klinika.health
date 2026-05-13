import { apiFetch } from './api';

export type AuthRole = 'doctor' | 'receptionist' | 'clinic_admin' | 'platform_admin';

export interface LoginInput {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface LoginResponse {
  status: 'authenticated' | 'mfa_required';
  role?: AuthRole;
  pendingSessionId?: string;
  maskedEmail?: string;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: AuthRole;
    title: string | null;
    clinicName: string;
    clinicShortName: string;
    createdAt: string;
    lastLoginAt: string | null;
  };
}

export interface SessionRow {
  id: string;
  deviceLabel: string;
  ipAddress: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  isCurrent: boolean;
  extendedTtl: boolean;
}

export interface TrustedDeviceRow {
  id: string;
  label: string;
  ipAddress: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export type PasswordStrength =
  | 'empty'
  | 'weak'
  | 'fair'
  | 'medium'
  | 'strong'
  | 'very_strong';

export interface PasswordStrengthResponse {
  strength: PasswordStrength;
  acceptable: boolean;
}

export const authClient = {
  login: (input: LoginInput) => apiFetch<LoginResponse>('/api/auth/login', { method: 'POST', json: input }),
  mfaVerify: (input: { pendingSessionId: string; code: string; trustDevice: boolean }) =>
    apiFetch<{ role: AuthRole }>('/api/auth/mfa/verify', { method: 'POST', json: input }),
  mfaResend: (input: { pendingSessionId: string }) =>
    apiFetch<{ maskedEmail: string }>('/api/auth/mfa/resend', { method: 'POST', json: input }),
  passwordResetRequest: (input: { email: string }) =>
    apiFetch<{ status: 'ok' }>('/api/auth/password-reset/request', { method: 'POST', json: input }),
  passwordResetConfirm: (input: { token: string; newPassword: string }) =>
    apiFetch<{ status: 'ok' }>('/api/auth/password-reset/confirm', { method: 'POST', json: input }),
  passwordChange: (input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) => apiFetch<{ status: 'ok' }>('/api/auth/password-change', { method: 'POST', json: input }),
  passwordStrength: (password: string) =>
    apiFetch<PasswordStrengthResponse>('/api/auth/password-strength', {
      method: 'POST',
      json: { password },
    }),
  me: () => apiFetch<MeResponse>('/api/auth/me', { method: 'GET' }),
  sessions: () => apiFetch<{ sessions: SessionRow[] }>('/api/auth/sessions', { method: 'GET' }),
  trustedDevices: () =>
    apiFetch<{ devices: TrustedDeviceRow[] }>('/api/auth/trusted-devices', { method: 'GET' }),
  revokeTrustedDevice: (id: string) =>
    apiFetch<{ status: 'ok' }>(`/api/auth/trusted-devices/${id}`, { method: 'DELETE' }),
  revokeAllTrustedDevices: () =>
    apiFetch<{ status: 'ok'; count: number }>('/api/auth/trusted-devices/revoke-all', {
      method: 'POST',
    }),
  revokeOtherSessions: () =>
    apiFetch<{ status: 'ok'; count: number }>('/api/auth/sessions/revoke-others', { method: 'POST' }),
  revokeSession: (id: string) =>
    apiFetch<{ status: 'ok' }>(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  logout: () => apiFetch<{ status: 'ok' }>('/api/auth/logout', { method: 'POST' }),
};

/** Map a role to its post-login landing route. */
export function homePathForRole(role: AuthRole): string {
  switch (role) {
    case 'doctor':
      return '/doctor';
    case 'receptionist':
      return '/receptionist';
    case 'clinic_admin':
      return '/clinic';
    case 'platform_admin':
      return '/admin';
  }
}
