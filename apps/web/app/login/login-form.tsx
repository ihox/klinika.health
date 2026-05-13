'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { authClient, homePathForRole } from '@/lib/auth-client';

const LoginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Email-i mungon')
    .email('Email-i është i pasaktë'),
  password: z.string().min(1, 'Fjalëkalimi mungon'),
  rememberMe: z.boolean(),
});

type LoginFormValues = z.infer<typeof LoginSchema>;

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(searchParamMessage(searchParams));
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '', rememberMe: true },
  });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await authClient.login(values);
      if (result.status === 'mfa_required' && result.pendingSessionId && result.maskedEmail) {
        const params = new URLSearchParams({
          s: result.pendingSessionId,
          e: result.maskedEmail,
        });
        router.push(`/verify?${params.toString()}`);
        return;
      }
      if (result.status === 'authenticated' && result.role) {
        router.push(homePathForRole(result.role));
        return;
      }
      setFormError('Hyrja dështoi. Provoni përsëri.');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 429) {
          setFormError('Tepër kërkesa. Provoni përsëri pas pak minutash.');
        } else if (err.status === 401) {
          setFormError('Email-i ose fjalëkalimi është i pasaktë.');
        } else if (err.status === 403) {
          setFormError(err.body.message ?? 'Hyrja kërkon nëndomenin e klinikës.');
        } else {
          setFormError(err.body.message ?? 'Diçka shkoi keq. Provoni përsëri.');
        }
      } else {
        setFormError('Gabim i rrjetit. Provoni përsëri.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="mt-px shrink-0">
            <path d="M8 2.5l6 10.5H2z" />
            <path d="M8 6.5v3M8 11.5v.01" />
          </svg>
          <span>{formError}</span>
        </div>
      ) : null}

      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          invalid={Boolean(errors.email)}
          {...register('email')}
        />
      </Field>

      <Field label="Fjalëkalimi" htmlFor="password" error={errors.password?.message}>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          invalid={Boolean(errors.password)}
          {...register('password')}
        />
      </Field>

      <div className="flex justify-between items-center mt-1">
        <label className="flex items-center gap-2 text-[13px] text-stone-600 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-teal-600"
            {...register('rememberMe')}
          />
          Më mbaj të kyçur (në këtë pajisje)
        </label>
        <Link
          href="/forgot-password"
          className="text-[13px] font-medium text-teal-700 hover:text-teal-800 hover:underline"
        >
          Harruat fjalëkalimin?
        </Link>
      </div>

      <Button type="submit" size="lg" disabled={submitting} className="mt-2">
        {submitting ? 'Po hyhet…' : 'Hyr'}
      </Button>
    </form>
  );
}

function searchParamMessage(params: ReturnType<typeof useSearchParams>): string | null {
  const reason = params.get('reason');
  if (reason === 'mfa-attempts') return 'Tepër përpjekje. Filloni prej fillimit.';
  if (reason === 'session-expired') return 'Sesioni juaj ka skaduar. Hyni përsëri.';
  if (reason === 'password-changed') return 'Fjalëkalimi u rivendos. Hyni me të riun.';
  return null;
}
