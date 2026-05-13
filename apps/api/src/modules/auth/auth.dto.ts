import { z } from 'zod';

/**
 * Zod schemas for every auth endpoint. The frontend imports the
 * inferred TypeScript types via the same module so request/response
 * shapes are checked end-to-end.
 *
 * The error messages here are Albanian because they may surface in
 * UI if the frontend trusts the API's `message` field for a 4xx.
 */

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Email-i mungon')
  .max(254, 'Email-i është shumë i gjatë')
  .email('Email-i është i pasaktë');

export const LoginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Fjalëkalimi mungon').max(256, 'Fjalëkalimi është shumë i gjatë'),
  rememberMe: z.boolean().default(false),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export interface LoginResponse {
  status: 'mfa_required' | 'authenticated';
  pendingSessionId?: string;
  maskedEmail?: string;
  redirectTo?: string;
}

export const MfaVerifyRequestSchema = z.object({
  pendingSessionId: z.string().min(1).max(256),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Kodi duhet të jetë 6 shifra'),
  trustDevice: z.boolean().default(true),
});
export type MfaVerifyRequest = z.infer<typeof MfaVerifyRequestSchema>;

export const MfaResendRequestSchema = z.object({
  pendingSessionId: z.string().min(1).max(256),
});
export type MfaResendRequest = z.infer<typeof MfaResendRequestSchema>;

export const PasswordResetRequestSchema = z.object({
  email: emailSchema,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: z.string().min(10, 'Të paktën 10 karaktere').max(256),
});
export type PasswordResetConfirm = z.infer<typeof PasswordResetConfirmSchema>;

export const PasswordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: z.string().min(10, 'Të paktën 10 karaktere').max(256),
    confirmPassword: z.string().min(1).max(256),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Konfirmimi nuk përputhet',
    path: ['confirmPassword'],
  });
export type PasswordChangeRequest = z.infer<typeof PasswordChangeSchema>;

export const RevokeTrustedDeviceSchema = z.object({
  deviceId: z.string().uuid(),
});
export type RevokeTrustedDeviceRequest = z.infer<typeof RevokeTrustedDeviceSchema>;

export const RevokeSessionSchema = z.object({
  sessionId: z.string().uuid(),
});
export type RevokeSessionRequest = z.infer<typeof RevokeSessionSchema>;

export const PasswordStrengthRequestSchema = z.object({
  password: z.string().max(256),
});
export type PasswordStrengthRequest = z.infer<typeof PasswordStrengthRequestSchema>;
