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
  const [sentEmail, setSentEmail] = useState<string | null>(null);
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
      setSentEmail(values.email);
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
      <div className="flex flex-col gap-4">
        <div
          aria-hidden="true"
          className="grid h-14 w-14 place-items-center rounded-full border border-teal-200 bg-teal-100 text-teal-800"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 7l9 6 9-6" />
            <rect x="3" y="5" width="18" height="14" rx="2" />
          </svg>
        </div>
        <div>
          <div className="font-display text-[20px] font-semibold tracking-tight text-stone-900">
            Email-i u dërgua
          </div>
          <div className="mt-1.5 text-[13px] leading-relaxed text-stone-500">
            Kontrolloni kutinë e{' '}
            <span className="inline-block rounded border border-stone-200 bg-stone-100 px-1.5 py-px font-mono text-[12.5px] font-medium text-stone-700">
              {sentEmail ?? 'email-it tuaj'}
            </span>{' '}
            — link-u vlen për 60 minuta.
          </div>
        </div>
        <div className="grid grid-cols-[16px_1fr] items-start gap-2.5 rounded-md border border-stone-200 bg-stone-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-stone-600">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 text-stone-400"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="5.5" />
            <path d="M7 4v3.5l2 1.2" />
          </svg>
          <div>
            Nuk e gjeni? Kontrolloni dosjen{' '}
            <strong className="font-semibold text-stone-800">Spam</strong> ose{' '}
            <strong className="font-semibold text-stone-800">Promotions</strong>. Email-i vjen nga{' '}
            <code className="font-mono text-[11.5px] text-stone-700">noreply@klinika.health</code>.
          </div>
        </div>
        <Link
          href="/login"
          className="self-start text-[13px] text-stone-500 hover:text-stone-700 hover:underline"
        >
          ← Kthehu te hyrja
        </Link>
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
