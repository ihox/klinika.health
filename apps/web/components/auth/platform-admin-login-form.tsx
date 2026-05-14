'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { BrandRow } from '@/components/auth/brand-row';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { adminClient } from '@/lib/admin-client';

const LoginSchema = z.object({
  email: z.string().trim().min(1, 'Email-i mungon').email('Email-i është i pasaktë'),
  password: z.string().min(1, 'Fjalëkalimi mungon'),
});
const MfaSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Kodi duhet të jetë 6 shifra'),
});

type LoginValues = z.infer<typeof LoginSchema>;
type MfaValues = z.infer<typeof MfaSchema>;

interface MfaState {
  pendingSessionId: string;
  maskedEmail: string;
}

/**
 * Platform-admin login form rendered on the apex domain at `/login`.
 *
 * Identical shape to the previous /admin/login form but lives in
 * `components/` now because the apex `/login` page is host-aware
 * (ADR-005 boundary fix). The form switches inline to the MFA step
 * after the password is accepted — no separate /verify route for
 * platform admins.
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
  const mfaForm = useForm<MfaValues>({
    resolver: zodResolver(MfaSchema),
    defaultValues: { code: '' },
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

  const onMfa = mfaForm.handleSubmit(async (values) => {
    if (!mfaState) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await adminClient.mfaVerify({
        pendingSessionId: mfaState.pendingSessionId,
        code: values.code,
      });
      router.replace(redirect);
    } catch (err) {
      setFormError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  });

  const onResend = async () => {
    if (!mfaState) return;
    setFormError(null);
    try {
      const out = await adminClient.mfaResend({ pendingSessionId: mfaState.pendingSessionId });
      setMfaState({ ...mfaState, maskedEmail: out.maskedEmail });
    } catch (err) {
      setFormError(authErrorMessage(err));
    }
  };

  return (
    <div className="w-full max-w-[400px]">
      <div className="flex items-baseline gap-2.5 mb-8">
        <BrandRow size={28} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">
          Admini i Platformës
        </span>
      </div>

      <h1 className="font-display text-[24px] font-semibold tracking-[-0.025em] text-stone-900">
        {mfaState ? 'Verifikimi me dy hapa' : 'Hyrja për admin'}
      </h1>
      <p className="mt-1.5 mb-7 text-[13px] text-stone-500">
        {mfaState
          ? `Kodi 6-shifror u dërgua në ${mfaState.maskedEmail}.`
          : 'Hyrja kërkon verifikim me email në çdo seancë.'}
      </p>

      {!mfaState ? (
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
      ) : (
        <form onSubmit={onMfa} className="flex flex-col gap-4" noValidate>
          <Field
            label="Kodi i verifikimit"
            htmlFor="admin-mfa-code"
            error={mfaForm.formState.errors.code?.message}
            hint="6 shifra, vlen 15 minuta"
          >
            <Input
              id="admin-mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="text-center text-[20px] tracking-[0.4em] font-mono"
              {...mfaForm.register('code')}
              invalid={Boolean(mfaForm.formState.errors.code)}
            />
          </Field>
          {formError ? <p className="text-[12.5px] text-amber-700">{formError}</p> : null}
          <Button type="submit" disabled={submitting} size="lg">
            {submitting ? 'Po verifikohet…' : 'Hyr'}
          </Button>
          <button
            type="button"
            onClick={onResend}
            className="text-[13px] text-teal-700 hover:underline text-center"
          >
            Dërgo kodin përsëri
          </button>
        </form>
      )}

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
