import { z } from 'zod';

/**
 * Wire shapes for the `/api/admin/*` surface. Zod schemas so the
 * controller can validate at the boundary; TypeScript types inferred
 * for use in services and frontend.
 *
 * Albanian error messages live in the API layer — if the response
 * surfaces them directly in a 4xx, the UI is consistent with the
 * tenant-side auth controller.
 */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email-i mungon')
  .max(254, 'Email-i është shumë i gjatë')
  .email('Email-i është i pasaktë');

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const AdminLoginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Fjalëkalimi mungon').max(256),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminMfaVerifyRequestSchema = z.object({
  pendingSessionId: z.string().min(1).max(256),
  code: z.string().trim().regex(/^\d{6}$/, 'Kodi duhet të jetë 6 shifra'),
});
export type AdminMfaVerifyRequest = z.infer<typeof AdminMfaVerifyRequestSchema>;

export const AdminMfaResendRequestSchema = z.object({
  pendingSessionId: z.string().min(1).max(256),
});
export type AdminMfaResendRequest = z.infer<typeof AdminMfaResendRequestSchema>;

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

const phoneSchema = z.string().trim().min(3).max(40);

export const CreateTenantRequestSchema = z.object({
  name: z.string().trim().min(2, 'Emri duhet të ketë të paktën 2 karaktere').max(160),
  shortName: z.string().trim().min(2, 'Emri i shkurtuar duhet të ketë të paktën 2 karaktere').max(60),
  subdomain: z
    .string()
    .trim()
    .toLowerCase()
    .min(2, 'Subdomain mungon')
    .max(40, 'Subdomain është shumë i gjatë'),
  city: z.string().trim().min(1, 'Qyteti mungon').max(80),
  address: z.string().trim().min(1, 'Adresa mungon').max(240),
  phones: z.array(phoneSchema).min(1, 'Të paktën një telefon').max(5),
  contactEmail: emailSchema,
  adminFirstName: z.string().trim().min(1, 'Emri i adminit mungon').max(80),
  adminLastName: z.string().trim().min(1, 'Mbiemri i adminit mungon').max(80),
  adminEmail: emailSchema,
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const SubdomainAvailabilityQuerySchema = z.object({
  subdomain: z.string().trim().toLowerCase().min(1).max(64),
});
export type SubdomainAvailabilityQuery = z.infer<typeof SubdomainAvailabilityQuerySchema>;

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

export interface TenantDetail extends TenantSummary {
  address: string;
  phones: string[];
  contactEmail: string;
  users: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    isActive: boolean;
    lastLoginAt: string | null;
  }>;
  telemetry: {
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
  };
  recentAudit: Array<{
    id: string;
    action: string;
    resourceType: string;
    timestamp: string;
    actorEmail: string | null;
  }>;
}

// ---------------------------------------------------------------------------
// Platform admins
// ---------------------------------------------------------------------------

export const CreatePlatformAdminRequestSchema = z.object({
  email: emailSchema,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
});
export type CreatePlatformAdminRequest = z.infer<typeof CreatePlatformAdminRequestSchema>;

export interface PlatformAdminSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Health rollup
// ---------------------------------------------------------------------------

export interface PlatformHealthSnapshot {
  generatedAt: string;
  tenants: {
    total: number;
    active: number;
    suspended: number;
  };
  users: {
    total: number;
    activeToday: number;
  };
  patients: {
    total: number;
    visitsThisMonth: number;
  };
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
