'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { BrandLogo } from '@/components/brand-logo';
import {
  MfaVerifyForm,
  type MfaResendResult,
  type MfaVerifyResult,
} from '@/components/auth/mfa-verify-form';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { adminClient } from '@/lib/admin-client';

const LoginSchema = z.object({
  email: z.string().trim().min(1, 'Email-i mungon').email('Email-i është i pasaktë'),
  password: z.string().min(1, 'Fjalëkalimi mungon'),
});

type LoginValues = z.infer<typeof LoginSchema>;

interface MfaState {
  pendingSessionId: string;
  maskedEmail: string;
}

/**
 * Platform-admin login form rendered on the apex domain at `/login`.
 *
 * The MFA step renders the shared `<MfaVerifyForm>` (the same component
 * used by the clinic /verify route) so both flows are visually
 * identical — same logo, copy, OTP cells, trusted-device checkbox,
 * resend cooldown, and locked-out banner. Only the underlying API
 * surface differs: this form posts to `/api/admin/auth/*`, while the
 * clinic flow uses `/api/auth/*`.
 */
export function PlatformAdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams?.get('redirect') ?? '/admin';
  const [mfaState, setMfaState] = useState<MfaState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loginForm = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onLogin = loginForm.handleSubmit(async (values) => {
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await adminClient.login(values);
      if (result.status === 'mfa_required' && result.pendingSessionId && result.maskedEmail) {
        setMfaState({
          pendingSessionId: result.pendingSessionId,
          maskedEmail: result.maskedEmail,
        });
        return;
      }
      router.replace(redirect);
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  });

  // Visual parity with the clinic MFA: the shared form collects a
  // `trustDevice` value, but the admin API doesn't accept it today
  // (adminClient.mfaVerify has no trustDevice field). The checkbox
  // is purely cosmetic for admin until trusted devices become a
  // real platform-admin feature — at which point wire it through
  // here.
  const handleMfaVerify = async ({ code }: { code: string }): Promise<MfaVerifyResult> => {
    if (!mfaState) return { ok: false, kind: 'unknown' };
    try {
      await adminClient.mfaVerify({ pendingSessionId: mfaState.pendingSessionId, code });
      return { ok: true };
    } catch (err) {
      return mapVerifyError(err);
    }
  };

  const handleMfaResend = async (): Promise<MfaResendResult> => {
    if (!mfaState) return { ok: false, kind: 'unknown' };
    try {
      const out = await adminClient.mfaResend({ pendingSessionId: mfaState.pendingSessionId });
      setMfaState({ ...mfaState, maskedEmail: out.maskedEmail });
      return { ok: true, maskedEmail: out.maskedEmail };
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        return { ok: false, kind: 'rate_limited' };
      }
      return { ok: false, kind: 'unknown' };
    }
  };

  if (mfaState) {
    return (
      <MfaVerifyForm
        maskedEmail={mfaState.maskedEmail}
        onVerify={handleMfaVerify}
        onResend={handleMfaResend}
        onSuccess={() => router.replace(redirect)}
      />
    );
  }

  return (
    <div className="w-full max-w-[400px]">
      <div className="flex items-baseline gap-2.5 mb-8">
        <BrandLogo height={28} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
          Admini i Platformës
        </span>
      </div>

      <h1 className="font-display text-[24px] font-semibold tracking-[-0.025em] text-stone-900">
        Hyrja për admin
      </h1>
      <p className="mt-1.5 mb-7 text-[13px] text-stone-500">
        Hyrja kërkon verifikim me email në çdo seancë.
      </p>

      <form onSubmit={onLogin} className="flex flex-col gap-4" noValidate>
        <Field
          label="Email"
          htmlFor="admin-login-email"
          error={loginForm.formState.errors.email?.message}
        >
          <Input
            id="admin-login-email"
            type="email"
            autoComplete="email"
            {...loginForm.register('email')}
            invalid={Boolean(loginForm.formState.errors.email)}
          />
        </Field>
        <Field
          label="Fjalëkalimi"
          htmlFor="admin-login-password"
          error={loginForm.formState.errors.password?.message}
        >
          <Input
            id="admin-login-password"
            type="password"
            autoComplete="current-password"
            {...loginForm.register('password')}
            invalid={Boolean(loginForm.formState.errors.password)}
          />
        </Field>
        {formError ? <p className="text-[12.5px] text-amber-700">{formError}</p> : null}
        <Button type="submit" disabled={submitting} size="lg">
          {submitting ? 'Po hyhet…' : 'Vazhdo'}
        </Button>
      </form>

      <div className="mt-10 pt-5 border-t border-stone-200 flex justify-between text-[12px] text-stone-400">
        <span>klinika.health</span>
        <span>v1.0</span>
      </div>
    </div>
  );
}

function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return 'Tepër kërkesa. Provoni përsëri pas pak minutash.';
    }
    if (err.status === 401) {
      return err.body.message ?? 'Email-i ose fjalëkalimi është i pasaktë.';
    }
    if (err.status === 403) {
      return err.body.message ?? 'Hyrja u refuzua.';
    }
    return err.body.message ?? 'Diçka shkoi keq. Provoni përsëri.';
  }
  return 'Gabim i rrjetit. Provoni përsëri.';
}

function mapVerifyError(err: unknown): MfaVerifyResult {
  if (!(err instanceof ApiError)) {
    return { ok: false, kind: 'network', message: 'Gabim i rrjetit. Provoni përsëri.' };
  }
  if (err.status === 401) {
    const reason = err.body.reason;
    if (reason === 'too_many_attempts') return { ok: false, kind: 'too_many_attempts' };
    if (reason === 'expired') {
      return { ok: false, kind: 'expired_code', message: err.body.message };
    }
    return { ok: false, kind: 'invalid_code', message: err.body.message };
  }
  if (err.status === 429) {
    return { ok: false, kind: 'rate_limited', message: err.body.message };
  }
  return { ok: false, kind: 'unknown', message: err.body.message };
}
