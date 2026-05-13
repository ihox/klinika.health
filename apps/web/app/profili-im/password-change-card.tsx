'use client';

import { zodResolver } from '@hookform/resolvers/zod';
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
    currentPassword: z.string().min(1, 'Fjalëkalimi aktual mungon'),
    newPassword: z.string().min(10, 'Të paktën 10 karaktere'),
    confirmPassword: z.string().min(1, 'Konfirmoni fjalëkalimin'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Konfirmimi nuk përputhet',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof Schema>;

export function PasswordChangeCard() {
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword');

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      await authClient.passwordChange(values);
      setSuccess(true);
      reset();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.body.message ?? 'Ndryshimi dështoi.');
      } else {
        setError('Gabim i rrjetit. Provoni përsëri.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6 mb-6">
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-[16px] font-semibold text-stone-900">
          Ndrysho fjalëkalimin
        </h2>
        <span className="text-[12px] text-stone-400">Të paktën 10 karaktere</span>
      </header>
      <form onSubmit={onSubmit} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-6 gap-y-4" noValidate>
        {success ? (
          <div className="sm:col-span-2 rounded-md border border-teal-100 bg-teal-50 p-3 text-[13px] text-teal-900">
            Fjalëkalimi u ndryshua.
          </div>
        ) : null}
        {error ? (
          <div className="sm:col-span-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
            {error}
          </div>
        ) : null}

        <label htmlFor="currentPassword" className="text-[12.5px] text-stone-600 self-center">
          Fjalëkalimi aktual
        </label>
        <Field error={errors.currentPassword?.message}>
          <Input
            id="currentPassword"
            type="password"
            autoComplete="current-password"
            invalid={Boolean(errors.currentPassword)}
            {...register('currentPassword')}
          />
        </Field>

        <label htmlFor="newPassword" className="text-[12.5px] text-stone-600 self-center">
          Fjalëkalimi i ri
        </label>
        <Field error={errors.newPassword?.message}>
          <Input
            id="newPassword"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.newPassword)}
            {...register('newPassword')}
          />
        </Field>

        <span className="text-[12.5px] text-stone-400 self-center">Force i fjalëkalimit</span>
        <div className="self-center">
          <PasswordStrengthIndicator password={newPassword} />
        </div>

        <label htmlFor="confirmPassword" className="text-[12.5px] text-stone-600 self-center">
          Konfirmo
        </label>
        <Field error={errors.confirmPassword?.message}>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            invalid={Boolean(errors.confirmPassword)}
            {...register('confirmPassword')}
          />
        </Field>

        <div className="sm:col-span-2 flex justify-end gap-2 mt-2">
          <Button type="button" variant="secondary" onClick={() => reset()}>
            Anulo
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Po ruhet…' : 'Ruaj'}
          </Button>
        </div>
      </form>
    </section>
  );
}
