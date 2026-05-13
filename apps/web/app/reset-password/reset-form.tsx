'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { PasswordStrengthIndicator } from '@/components/auth/password-strength';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

const Schema = z
  .object({
    newPassword: z.string().min(10, 'Të paktën 10 karaktere'),
    confirmPassword: z.string().min(1, 'Konfirmoni fjalëkalimin'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Konfirmimi nuk përputhet',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof Schema>;

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('t');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword');

  const onSubmit = handleSubmit(async (values) => {
    if (!token) {
      setError('Lidhja nuk është e vlefshme.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authClient.passwordResetConfirm({ token, newPassword: values.newPassword });
      router.replace('/login?reason=password-changed');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.body.message ?? 'Rivendosja dështoi. Provoni përsëri.');
      } else {
        setError('Gabim i rrjetit. Provoni përsëri.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  if (!token) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
        Lidhja nuk është e vlefshme ose ka skaduar.{' '}
        <Link href="/forgot-password" className="font-medium underline">
          Kërkoni një lidhje të re
        </Link>
        .
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {error ? (
        <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
          {error}
        </div>
      ) : null}
      <Field label="Fjalëkalimi i ri" htmlFor="newPassword" error={errors.newPassword?.message}>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          invalid={Boolean(errors.newPassword)}
          {...register('newPassword')}
        />
      </Field>
      <div className="mt-1">
        <div className="text-[12px] font-medium uppercase tracking-wide text-stone-500 mb-2">
          Force i fjalëkalimit
        </div>
        <PasswordStrengthIndicator password={newPassword} />
      </div>
      <Field label="Konfirmo" htmlFor="confirmPassword" error={errors.confirmPassword?.message}>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          invalid={Boolean(errors.confirmPassword)}
          {...register('confirmPassword')}
        />
      </Field>
      <Button type="submit" size="lg" disabled={submitting} className="mt-2">
        {submitting ? 'Po ruhet…' : 'Vendos fjalëkalimin'}
      </Button>
    </form>
  );
}
