import { z } from 'zod';

/**
 * Wire shapes for the `/api/clinic/*` settings surface. Zod schemas
 * validate at the boundary; TypeScript types are inferred for use in
 * services and the frontend.
 *
 * Albanian error messages stay close to what the prototype shows so
 * the form can surface them inline without translation in the UI.
 */

// ---------------------------------------------------------------------------
// General — identity + contact
// ---------------------------------------------------------------------------

const phoneSchema = z.string().trim().min(3, 'Numri është shumë i shkurtër').max(40);

export const WalkinDurationSchema = z
  .number()
  .int('Vlera duhet të jetë numër i plotë')
  .min(5, 'Minimumi 5 minuta')
  .max(60, 'Maksimumi 60 minuta')
  .refine((v) => v % 5 === 0, {
    message: 'Vlera duhet të jetë shumëfish i 5',
  });

export const ClinicGeneralUpdateSchema = z.object({
  name: z.string().trim().min(2, 'Emri duhet të ketë të paktën 2 karaktere').max(160),
  shortName: z.string().trim().min(2, 'Emri i shkurtuar duhet të ketë të paktën 2 karaktere').max(60),
  address: z.string().trim().min(1, 'Adresa mungon').max(240),
  city: z.string().trim().min(1, 'Qyteti mungon').max(80),
  phones: z.array(phoneSchema).min(1, 'Të paktën një telefon').max(8),
  email: z.string().trim().toLowerCase().email('Email-i është i pasaktë').max(254),
  walkinDurationMinutes: WalkinDurationSchema,
});
export type ClinicGeneralUpdate = z.infer<typeof ClinicGeneralUpdateSchema>;

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TimeStringSchema = z.string().regex(TIME_PATTERN, 'Ora duhet të jetë HH:MM');

export const HoursDayOpenSchema = z
  .object({
    open: z.literal(true),
    start: TimeStringSchema,
    end: TimeStringSchema,
  })
  .strict();

export const HoursDayClosedSchema = z
  .object({
    open: z.literal(false),
  })
  .strict();

// `discriminatedUnion` rejects `ZodEffects` so we apply the
// `start < end` invariant at the day-level after discrimination.
export const HoursDaySchema = z
  .discriminatedUnion('open', [HoursDayOpenSchema, HoursDayClosedSchema])
  .superRefine((v, ctx) => {
    if (v.open && v.start >= v.end) {
      ctx.addIssue({
        code: 'custom',
        message: 'Mbyllja duhet pas hapjes',
        path: ['end'],
      });
    }
  });

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const HoursConfigSchema = z
  .object({
    timezone: z.literal('Europe/Belgrade').default('Europe/Belgrade'),
    days: z.object({
      mon: HoursDaySchema,
      tue: HoursDaySchema,
      wed: HoursDaySchema,
      thu: HoursDaySchema,
      fri: HoursDaySchema,
      sat: HoursDaySchema,
      sun: HoursDaySchema,
    }),
    durations: z
      .array(z.number().int().min(1).max(120))
      .min(1, 'Të paktën një kohëzgjatje')
      .max(12, 'Tepër kohëzgjatje'),
    defaultDuration: z.number().int().min(1).max(120),
  })
  .refine((v) => v.durations.includes(v.defaultDuration), {
    message: 'Kohëzgjatja e parazgjedhur duhet të jetë në listë',
    path: ['defaultDuration'],
  })
  .refine(
    (v) => {
      const set = new Set(v.durations);
      return set.size === v.durations.length;
    },
    { message: 'Kohëzgjatjet duhen të jenë unike', path: ['durations'] },
  );
export type HoursConfig = z.infer<typeof HoursConfigSchema>;

// ---------------------------------------------------------------------------
// Payment codes
// ---------------------------------------------------------------------------

const CodeKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]$/, 'Kodi duhet të jetë një shkronjë A–Z');

export const PaymentCodeSchema = z
  .object({
    label: z.string().trim().min(1, 'Përshkrimi mungon').max(120),
    amountCents: z.number().int().min(0, 'Çmimi nuk mund të jetë negativ').max(1_000_000),
  })
  .strict();
export type PaymentCode = z.infer<typeof PaymentCodeSchema>;

/**
 * The stored shape is `Record<letter, PaymentCode>`. Codes are stable
 * identifiers (E, A, B, C, D for DonetaMED) — labels and amounts are
 * editable, the letter is immutable once a code is created so legacy
 * visits keep referring to the same code.
 */
export const PaymentCodesSchema = z
  .record(CodeKeySchema, PaymentCodeSchema)
  .superRefine((map, ctx) => {
    const keys = Object.keys(map);
    if (keys.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Të paktën një kod' });
      return;
    }
    if (keys.length > 26) {
      ctx.addIssue({ code: 'custom', message: 'Tepër kode' });
    }
  });
export type PaymentCodes = z.infer<typeof PaymentCodesSchema>;

// ---------------------------------------------------------------------------
// SMTP
// ---------------------------------------------------------------------------

/**
 * The DB shape stores the SMTP password encrypted at rest. The wire
 * shape on PUT is plain text; the service encrypts before persisting.
 * GET responses omit the password entirely; the UI shows masked dots.
 */
export const SmtpUpdateRequestSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('default') }),
  z.object({
    mode: z.literal('smtp'),
    host: z.string().trim().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    username: z.string().trim().min(1).max(255),
    password: z.string().min(1).max(512).optional(),
    fromName: z.string().trim().min(1).max(160),
    fromAddress: z.string().trim().toLowerCase().email().max(254),
  }),
]);
export type SmtpUpdateRequest = z.infer<typeof SmtpUpdateRequestSchema>;

export const SmtpTestRequestSchema = z.object({
  toEmail: z.string().trim().toLowerCase().email('Email-i është i pasaktë').max(254),
});
export type SmtpTestRequest = z.infer<typeof SmtpTestRequestSchema>;

// ---------------------------------------------------------------------------
// File uploads (base64 JSON — no multer dependency)
// ---------------------------------------------------------------------------

const Base64Schema = z
  .string()
  .min(1, 'Skedari mungon')
  .max(6_000_000, 'Skedari është shumë i madh')
  .regex(/^[A-Za-z0-9+/=\s]+$/, 'Base64 i pavlefshëm');

export const LogoUploadSchema = z
  .object({
    contentType: z.enum(['image/png', 'image/svg+xml']),
    dataBase64: Base64Schema,
  })
  .strict();
export type LogoUpload = z.infer<typeof LogoUploadSchema>;

export const SignatureUploadSchema = z
  .object({
    contentType: z.literal('image/png'),
    dataBase64: Base64Schema,
  })
  .strict();
export type SignatureUpload = z.infer<typeof SignatureUploadSchema>;

// ---------------------------------------------------------------------------
// Users (clinic-admin tab)
// ---------------------------------------------------------------------------

const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email-i mungon')
  .max(254)
  .email('Email-i është i pasaktë');

export const ClinicRoleSchema = z.enum(['doctor', 'receptionist', 'clinic_admin']);

/**
 * Multi-role array (ADR-004). At least one role is required; the DB
 * CHECK constraints reject empty arrays and >3-element arrays
 * defensively, and the schema rejects duplicates here so the frontend
 * gets a clean error rather than a constraint violation. Order is not
 * load-bearing — the UI displays roles in a canonical chip order.
 */
export const ClinicRolesSchema = z
  .array(ClinicRoleSchema)
  .min(1, 'Të paktën një rol')
  .max(3, 'Tepër role')
  .refine((roles) => new Set(roles).size === roles.length, {
    message: 'Rolet duhet të jenë unike',
  });

export const CreateUserRequestSchema = z.object({
  email: emailField,
  firstName: z.string().trim().min(1, 'Emri mungon').max(80),
  lastName: z.string().trim().min(1, 'Mbiemri mungon').max(80),
  roles: ClinicRolesSchema,
  title: z.string().trim().max(60).optional(),
  credential: z.string().trim().max(120).optional(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  email: emailField,
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  roles: ClinicRolesSchema,
  title: z.string().trim().max(60).optional(),
  credential: z.string().trim().max(120).optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const SetUserActiveSchema = z.object({
  isActive: z.boolean(),
});
export type SetUserActive = z.infer<typeof SetUserActiveSchema>;

// ---------------------------------------------------------------------------
// Audit query
// ---------------------------------------------------------------------------

const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/, 'Datë e pavlefshme');

export const AuditQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  userId: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(80).optional(),
  resourceType: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  cursor: z.string().trim().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface ClinicSettingsResponse {
  general: {
    name: string;
    shortName: string;
    subdomain: string;
    address: string;
    city: string;
    phones: string[];
    email: string;
    /** Default duration (minutes) for walk-ins. Range 5–60. */
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
    smtp: {
      host: string;
      port: number;
      username: string;
      fromName: string;
      fromAddress: string;
      passwordSet: boolean;
    } | null;
  };
}

export interface ClinicUserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: Array<'doctor' | 'receptionist' | 'clinic_admin'>;
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

export interface AuditQueryResponse {
  rows: AuditRow[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Defaults — DonetaMED per CLAUDE.md §14, used by new tenants too.
// ---------------------------------------------------------------------------

export function defaultHoursConfig(): HoursConfig {
  const weekday = { open: true as const, start: '10:00', end: '18:00' };
  return {
    timezone: 'Europe/Belgrade',
    days: {
      mon: weekday,
      tue: weekday,
      wed: weekday,
      thu: weekday,
      fri: weekday,
      sat: weekday,
      sun: { open: false },
    },
    durations: [10, 15, 20, 30, 45],
    defaultDuration: 15,
  };
}

export function defaultPaymentCodes(): PaymentCodes {
  return {
    E: { label: 'Falas', amountCents: 0 },
    A: { label: 'Vizitë standarde', amountCents: 1500 },
    B: { label: 'Vizitë e shkurtër', amountCents: 1000 },
    C: { label: 'Kontroll', amountCents: 500 },
    D: { label: 'Vizitë e gjatë', amountCents: 2000 },
  };
}
