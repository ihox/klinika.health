'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

const Schema = z.object({
  email: z.string().trim().min(1, 'Email-i mungon').email('Email-i është i pasaktë'),
});

type FormValues = z.infer<typeof Schema>;

export function ForgotPasswordForm() {
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: { email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitting(true);
    setError(null);
    try {
      await authClient.passwordResetRequest({ email: values.email });
      setSent(true);
    } catch (err) {
      // The API returns 200 even for unknown emails to prevent
      // enumeration, so the only realistic error here is a network
      // issue or a rate-limit response.
      if (err instanceof ApiError && err.status === 429) {
        setError('Tepër kërkesa. Provoni përsëri pas pak.');
      } else {
        setError('Nuk u dërgua email-i. Provoni më vonë.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  if (sent) {
    return (
      <div className="rounded-md border border-teal-100 bg-teal-50 p-5 text-[13px] text-teal-900">
        <div className="font-medium text-teal-900 mb-1">Kontrolloni email-in</div>
        Nëse llogaria ekziston, do të merrni një lidhje për të vendosur fjalëkalimin e ri.
        Lidhja vlen për 60 minuta.
        <div className="mt-4">
          <Link href="/login" className="text-teal-700 hover:underline font-medium text-[13px]">
            ← Kthehu te hyrja
          </Link>
        </div>
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
      <Button type="submit" size="lg" disabled={submitting} className="mt-2">
        {submitting ? 'Po dërgohet…' : 'Dërgo lidhjen'}
      </Button>
      <Link
        href="/login"
        className="text-[13px] text-stone-500 hover:text-stone-700 hover:underline self-start"
      >
        ← Kthehu te hyrja
      </Link>
    </form>
  );
}
