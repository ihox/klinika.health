'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { adminClient } from '@/lib/admin-client';

const FormSchema = z.object({
  name: z.string().trim().min(2, 'Emri është shumë i shkurtër'),
  shortName: z.string().trim().min(2, 'Emri i shkurtuar mungon'),
  subdomain: z.string().trim().min(2, 'Subdomain mungon'),
  city: z.string().trim().min(1, 'Qyteti mungon'),
  address: z.string().trim().min(1, 'Adresa mungon'),
  phones: z.string().trim().min(3, 'Të paktën një telefon'),
  contactEmail: z.string().trim().min(1, 'Email-i mungon').email('Email-i është i pasaktë'),
  adminFirstName: z.string().trim().min(1, 'Emri i adminit mungon'),
  adminLastName: z.string().trim().min(1, 'Mbiemri i adminit mungon'),
  adminEmail: z.string().trim().min(1, 'Email-i mungon').email('Email-i është i pasaktë'),
});

type FormValues = z.infer<typeof FormSchema>;

type AvailabilityState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; subdomain: string }
  | { kind: 'unavailable'; reason: string };

export function CreateTenantView() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityState>({ kind: 'idle' });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: '',
      shortName: '',
      subdomain: '',
      city: '',
      address: '',
      phones: '',
      contactEmail: '',
      adminFirstName: '',
      adminLastName: '',
      adminEmail: '',
    },
  });

  const subdomainValue = watch('subdomain');

  // Live subdomain validation against the API. Debounced so the field
  // doesn't issue a request per keystroke. The server returns either
  // `available: true` or `available: false, reason`.
  useEffect(() => {
    const raw = subdomainValue.trim().toLowerCase();
    if (!raw) {
      setAvailability({ kind: 'idle' });
      return;
    }
    setAvailability({ kind: 'checking' });
    const handle = setTimeout(async () => {
      try {
        const result = await adminClient.checkSubdomain(raw);
        if (result.available) {
          setAvailability({ kind: 'available', subdomain: result.subdomain });
        } else {
          setAvailability({
            kind: 'unavailable',
            reason: result.reason ?? 'Subdomain është i pavlefshëm.',
          });
        }
      } catch {
        setAvailability({ kind: 'unavailable', reason: 'Gabim gjatë kontrollit.' });
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [subdomainValue]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    try {
      const phones = values.phones
        .split(/[,\n]/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (phones.length === 0) {
        setServerError('Të paktën një telefon.');
        return;
      }
      const out = await adminClient.createTenant({
        name: values.name,
        shortName: values.shortName,
        subdomain: values.subdomain.trim().toLowerCase(),
        city: values.city,
        address: values.address,
        phones,
        contactEmail: values.contactEmail.toLowerCase(),
        adminFirstName: values.adminFirstName,
        adminLastName: values.adminLastName,
        adminEmail: values.adminEmail.toLowerCase(),
      });
      router.replace(`/admin/tenants/${out.tenant.id}?created=1`);
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.body.message ?? 'Krijimi dështoi. Provoni përsëri.');
      } else {
        setServerError('Gabim i rrjetit. Provoni përsëri.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <section className="max-w-[640px]">
      <nav className="flex items-center gap-2 text-[12px] text-stone-500 mb-2">
        <Link href="/admin" className="hover:text-teal-700">
          ← Klinikat
        </Link>
        <span className="text-stone-300">/</span>
        <span className="text-stone-700 font-medium">Krijo klinikë</span>
      </nav>
      <header className="mb-6">
        <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-stone-900">
          Krijo klinikë të re
        </h1>
        <p className="mt-1 text-[13px] text-stone-500">
          Caktoni informacionet themelore. Admini i parë do të marrë një email me link për të
          caktuar fjalëkalimin.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
        <Section title="Informacionet">
          <Field label="Emri i plotë" htmlFor="t-name" error={errors.name?.message}>
            <Input
              id="t-name"
              placeholder="p.sh. Ambulanca Specialistike Pediatrike Aurora"
              invalid={Boolean(errors.name)}
              {...register('name')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emri i shkurtuar" htmlFor="t-short" error={errors.shortName?.message}>
              <Input
                id="t-short"
                placeholder="AURORA-PED"
                invalid={Boolean(errors.shortName)}
                {...register('shortName')}
              />
            </Field>
            <Field label="Qyteti" htmlFor="t-city" error={errors.city?.message}>
              <Input
                id="t-city"
                placeholder="Prishtinë"
                invalid={Boolean(errors.city)}
                {...register('city')}
              />
            </Field>
          </div>

          <Field
            label="Subdomain"
            htmlFor="t-subdomain"
            error={errors.subdomain?.message}
            hint={availabilityHint(availability)}
          >
            <div className="flex items-stretch border rounded-md overflow-hidden border-stone-300 focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/30 bg-white">
              <input
                id="t-subdomain"
                placeholder="emri-i-klinikes"
                className="flex-1 min-w-0 px-3 py-2 font-mono text-[13px] outline-none bg-transparent"
                data-testid="subdomain-input"
                {...register('subdomain', {
                  setValueAs: (v: string) => v.trim().toLowerCase(),
                })}
              />
              <span className="px-3 py-2 bg-stone-50 border-l border-stone-200 font-mono text-[12px] text-stone-500 flex items-center">
                .klinika.health
              </span>
            </div>
          </Field>
        </Section>

        <Section title="Kontakti">
          <Field label="Adresa" htmlFor="t-address" error={errors.address?.message}>
            <Input
              id="t-address"
              placeholder="Rruga, numri"
              invalid={Boolean(errors.address)}
              {...register('address')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Telefonat"
              htmlFor="t-phones"
              error={errors.phones?.message}
              hint="Ndani me presje për më shumë se një"
            >
              <Input
                id="t-phones"
                placeholder="045 00 00 00, 043 00 00 00"
                invalid={Boolean(errors.phones)}
                {...register('phones')}
              />
            </Field>
            <Field label="Email kontakti" htmlFor="t-email" error={errors.contactEmail?.message}>
              <Input
                id="t-email"
                type="email"
                placeholder="info@klinika.com"
                invalid={Boolean(errors.contactEmail)}
                {...register('contactEmail')}
              />
            </Field>
          </div>
        </Section>

        <Section title="Admin i parë i klinikës">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emri" htmlFor="t-admin-first" error={errors.adminFirstName?.message}>
              <Input
                id="t-admin-first"
                placeholder="Emri"
                invalid={Boolean(errors.adminFirstName)}
                {...register('adminFirstName')}
              />
            </Field>
            <Field label="Mbiemri" htmlFor="t-admin-last" error={errors.adminLastName?.message}>
              <Input
                id="t-admin-last"
                placeholder="Mbiemri"
                invalid={Boolean(errors.adminLastName)}
                {...register('adminLastName')}
              />
            </Field>
          </div>
          <Field label="Email" htmlFor="t-admin-email" error={errors.adminEmail?.message}>
            <Input
              id="t-admin-email"
              type="email"
              placeholder="admini@klinika.com"
              invalid={Boolean(errors.adminEmail)}
              {...register('adminEmail')}
            />
          </Field>
          <div className="text-[12px] text-teal-900 bg-teal-50 border border-teal-200 rounded-md px-3 py-2.5 flex gap-2">
            <span className="font-semibold">i</span>
            <span>
              Do t&apos;i dërgohet një email me një fjalëkalim të përkohshëm. Admini duhet ta
              ndryshojë menjëherë pas hyrjes së parë.
            </span>
          </div>
        </Section>

        {serverError ? (
          <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[13px] p-3">
            {serverError}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Link href="/admin">
            <Button variant="secondary" type="button">
              Anulo
            </Button>
          </Link>
          <Button
            type="submit"
            size="md"
            disabled={submitting || availability.kind === 'unavailable'}
          >
            {submitting ? 'Po krijohet…' : 'Krijo klinikën'}
          </Button>
        </div>
      </form>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-[0.08em] text-stone-400 font-semibold pb-1 border-b border-stone-200">
        {title}
      </div>
      {children}
    </div>
  );
}

function availabilityHint(state: AvailabilityState): string {
  if (state.kind === 'idle') return '';
  if (state.kind === 'checking') return 'Po kontrollohet…';
  if (state.kind === 'available') return `✓ ${state.subdomain}.klinika.health · i lirë`;
  return `✗ ${state.reason}`;
}
