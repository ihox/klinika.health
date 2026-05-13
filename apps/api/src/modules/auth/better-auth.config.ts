// Klinika — Better-Auth configuration.
//
// We use Better-Auth's primitive set (Argon2 password hashing, secure
// session tokens, email-OTP-style 2FA, trusted-device cookies) but the
// actual HTTP handlers live in `auth.controller.ts` so we can
// orchestrate the multi-tenant subdomain routing, audit log, and
// Albanian email templates that Better-Auth's defaults don't know
// about. See ADR-004 ("We rely on Better-Auth's defaults where
// possible and customize only: Email templates, MFA UI, Audit log
// integration").
//
// This file is the single place Better-Auth-specific config lives so
// the version pin in package.json is checked at compile time. If
// Better-Auth ships breaking changes between minor versions, the
// import here will fail fast and we'll see it in CI.

import { betterAuth } from 'better-auth';

import { EmailService } from '../email/email.service';

export interface BuildBetterAuthOptions {
  secret: string;
  trustedDeviceTtlDays: number;
  email: EmailService;
}

/**
 * Construct the Better-Auth instance. Currently only used for its
 * password hashing helper exposure (`auth.api.hashPassword`) and to
 * surface the Better-Auth version on the about/health endpoint, but
 * the structure is in place for richer integration as the library
 * matures.
 */
export function buildBetterAuth(opts: BuildBetterAuthOptions): ReturnType<typeof betterAuth> {
  return betterAuth({
    secret: opts.secret,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 256,
      autoSignIn: false,
      sendResetPassword: async ({ user, url }: { user: { email: string; name?: string }; url: string }) => {
        await opts.email.sendPasswordReset(user.email, {
          firstName: user.name ?? user.email,
          resetUrl: url,
          ttlMinutes: 60,
        });
      },
    },
  });
}
