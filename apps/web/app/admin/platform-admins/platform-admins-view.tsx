'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { StatusChip } from '@/components/admin/status-chip';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { adminClient, type PlatformAdminSummary } from '@/lib/admin-client';
import { formatRelativeAlbanian } from '@/lib/format-relative';

const CreateSchema = z.object({
  email: z.string().trim().min(1, 'Email-i mungon').email('Email-i është i pasaktë'),
  firstName: z.string().trim().min(1, 'Emri mungon'),
  lastName: z.string().trim().min(1, 'Mbiemri mungon'),
});
type CreateValues = z.infer<typeof CreateSchema>;

export function PlatformAdminsView() {
  const [admins, setAdmins] = useState<PlatformAdminSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateValues>({
    resolver: zodResolver(CreateSchema),
    defaultValues: { email: '', firstName: '', lastName: '' },
  });

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    try {
      const out = await adminClient.listPlatformAdmins();
      setAdmins(out.admins);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gabim i panjohur.');
    }
  };

  const onCreate = handleSubmit(async (values) => {
    setSubmitting(true);
    setFormError(null);
    try {
      await adminClient.createPlatformAdmin({
        email: values.email.toLowerCase(),
        firstName: values.firstName,
        lastName: values.lastName,
      });
      reset();
      setShowForm(false);
      await load();
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.body.message ?? 'Krijimi dështoi.');
      } else {
        setFormError(err instanceof Error ? err.message : 'Gabim i panjohur.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <section>
      <header className="flex items-end justify-between gap-6 mb-5">
        <div>
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.02em] text-stone-900">
            Administratorët e platformës
          </h1>
          <p className="mt-1 text-[13px] text-stone-500">
            Llogari me akses në panelin /admin · jashtë klinikave të veçanta
          </p>
        </div>
        {!showForm ? (
          <Button onClick={() => setShowForm(true)} data-testid="show-create-admin">
            + Shto admin
          </Button>
        ) : null}
      </header>

      {error ? (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-[13px] p-3">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <form
          onSubmit={onCreate}
          className="bg-white border border-stone-200 rounded-lg shadow-sm p-5 mb-6 flex flex-col gap-3"
          noValidate
        >
          <h3 className="text-[13px] font-semibold text-stone-900">Shto admin të ri</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Emri" htmlFor="a-first" error={errors.firstName?.message}>
              <Input
                id="a-first"
                invalid={Boolean(errors.firstName)}
                {...register('firstName')}
              />
            </Field>
            <Field label="Mbiemri" htmlFor="a-last" error={errors.lastName?.message}>
              <Input
                id="a-last"
                invalid={Boolean(errors.lastName)}
                {...register('lastName')}
              />
            </Field>
          </div>
          <Field label="Email" htmlFor="a-email" error={errors.email?.message}>
            <Input
              id="a-email"
              type="email"
              invalid={Boolean(errors.email)}
              {...register('email')}
            />
          </Field>
          <div className="text-[12px] text-teal-900 bg-teal-50 border border-teal-200 rounded-md px-3 py-2.5 flex gap-2">
            <span className="font-semibold">i</span>
            <span>
              MFA me email aktivizohet automatikisht. Admini do të marrë një email me një
              fjalëkalim të përkohshëm.
            </span>
          </div>
          {formError ? <p className="text-[12.5px] text-amber-700">{formError}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setShowForm(false);
                reset();
                setFormError(null);
              }}
            >
              Anulo
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Po krijohet…' : 'Krijo admin'}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="bg-white border border-stone-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50">
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                Emri
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                Email
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                Statusi
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold px-5 py-2.5">
                Hyrja e fundit
              </th>
            </tr>
          </thead>
          <tbody>
            {admins === null ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-stone-500 text-[13px]">
                  Po ngarkohet…
                </td>
              </tr>
            ) : admins.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-stone-500 text-[13px]">
                  Asnjë admin platforme.
                </td>
              </tr>
            ) : (
              admins.map((a) => (
                <tr key={a.id} className="border-b border-stone-100 last:border-b-0">
                  <td className="px-5 py-3 text-[13px] text-stone-900 font-medium">
                    {a.firstName} {a.lastName}
                  </td>
                  <td className="px-5 py-3 font-mono text-[12px] text-stone-500">{a.email}</td>
                  <td className="px-5 py-3">
                    <StatusChip tone={a.isActive ? 'green' : 'stone'}>
                      {a.isActive ? 'Aktiv' : 'Çaktivizuar'}
                    </StatusChip>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-stone-500">
                    {formatRelativeAlbanian(a.lastLoginAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-5 text-[12px] text-teal-900 bg-teal-50 border border-teal-200 rounded-md px-4 py-3 flex gap-2">
        <span className="font-semibold">i</span>
        <span>
          <strong>Praktikë e mirë:</strong> mbani të paktën 2 admin platforme aktivë. Veprimet e
          administratorit shkruhen në audit log të platformës.
        </span>
      </div>
    </section>
  );
}
