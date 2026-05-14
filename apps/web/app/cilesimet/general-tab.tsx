'use client';

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { clinicClient, fileToBase64, type ClinicSettings } from '@/lib/clinic-client';
import {
  FieldHelp,
  FieldLabel,
  FormGrid,
  InfoTip,
  PaneHeader,
  SectionCard,
} from './section-card';

interface Props {
  settings: ClinicSettings;
  onChange: (next: ClinicSettings) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

interface GeneralForm {
  name: string;
  shortName: string;
  address: string;
  city: string;
  phones: string[];
  email: string;
}

export function GeneralTab({ settings, onChange, onToast }: Props) {
  const [form, setForm] = useState<GeneralForm>(() => ({
    name: settings.general.name,
    shortName: settings.general.shortName,
    address: settings.general.address,
    city: settings.general.city,
    phones: [...settings.general.phones],
    email: settings.general.email,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep local form in sync if `settings` changes from elsewhere (e.g.
  // a logo upload returns the latest snapshot).
  useEffect(() => {
    setForm({
      name: settings.general.name,
      shortName: settings.general.shortName,
      address: settings.general.address,
      city: settings.general.city,
      phones: [...settings.general.phones],
      email: settings.general.email,
    });
  }, [settings]);

  async function save(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const next = await clinicClient.updateGeneral({
        ...form,
        phones: form.phones.map((p) => p.trim()).filter((p) => p.length > 0),
      });
      onChange(next);
      onToast('Cilësimet u ruajtën.');
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Ruajtja dështoi.';
      setError(message);
      onToast(message, 'error');
    } finally {
      setSaving(false);
    }
  }

  function addPhone(): void {
    setForm((f) => ({ ...f, phones: [...f.phones, ''] }));
  }
  function setPhone(i: number, v: string): void {
    setForm((f) => ({ ...f, phones: f.phones.map((p, idx) => (idx === i ? v : p)) }));
  }
  function removePhone(i: number): void {
    setForm((f) => ({ ...f, phones: f.phones.filter((_, idx) => idx !== i) }));
  }

  return (
    <>
      <PaneHeader
        title="Përgjithshme"
        description="Informacionet bazë të klinikës që shfaqen në dokumente dhe në ndërfaqe."
      />

      <SectionCard
        title="Identiteti"
        description="Emri zyrtar i klinikës dhe logo që përdoret në dokumente."
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() =>
                setForm({
                  name: settings.general.name,
                  shortName: settings.general.shortName,
                  address: settings.general.address,
                  city: settings.general.city,
                  phones: [...settings.general.phones],
                  email: settings.general.email,
                })
              }
              disabled={saving}
            >
              Anulo
            </Button>
            <Button onClick={save} disabled={saving} data-testid="general-save">
              {saving ? 'Po ruhet…' : 'Ruaj'}
            </Button>
          </>
        }
      >
        <FormGrid>
          <FieldLabel htmlFor="name">Emri i plotë</FieldLabel>
          <Input
            id="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            data-testid="general-name"
          />

          <FieldLabel htmlFor="shortName">Emri i shkurtuar</FieldLabel>
          <div>
            <Input
              id="shortName"
              value={form.shortName}
              onChange={(e) => setForm({ ...form, shortName: e.target.value })}
            />
            <FieldHelp>Përdoret në kokën e dokumenteve dhe nënshkrime PDF.</FieldHelp>
          </div>

          <FieldLabel>Adresa</FieldLabel>
          <Input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />

          <FieldLabel>Qyteti</FieldLabel>
          <Input
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />

          <FieldLabel>Telefoni</FieldLabel>
          <div className="flex flex-col gap-1.5">
            {form.phones.map((p, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  className="flex-1"
                  value={p}
                  onChange={(e) => setPhone(i, e.target.value)}
                  data-testid={`phone-${i}`}
                />
                {form.phones.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => removePhone(i)}
                    className="h-8 w-8 grid place-items-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-red-700"
                    aria-label="Hiq"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              onClick={addPhone}
              className="self-start text-[12px] text-teal-700 hover:underline py-1"
            >
              + Shto numër
            </button>
          </div>

          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </FormGrid>
        {error ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 text-amber-900 text-[12.5px] px-3 py-2">
            {error}
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Logo dhe nënshkrimi"
        description="Logo printohet në çdo dokument. Nënshkrimi ruhet i koduar."
      >
        <BrandingPanel settings={settings} onChange={onChange} onToast={onToast} />
        <div className="mt-5">
          <InfoTip tone="warning">
            <strong>Vula fizike e klinikës duhet të vendoset manualisht në çdo dokument të printuar.</strong>{' '}
            Vulat digjitale nuk janë të lejuara në Kosovë.
          </InfoTip>
        </div>
      </SectionCard>
    </>
  );
}

function BrandingPanel({
  settings,
  onChange,
  onToast,
}: {
  settings: ClinicSettings;
  onChange: (next: ClinicSettings) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}) {
  const logoInput = useRef<HTMLInputElement>(null);
  const sigInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'logo' | 'signature' | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [sigUrl, setSigUrl] = useState<string | null>(null);

  // Pull current logo/signature as object URLs so we can preview them
  // in-place. These are authenticated proxy endpoints — we fetch with
  // credentials and turn the blob into a URL.
  useEffect(() => {
    let cancelled = false;
    if (!settings.branding.hasLogo) {
      setLogoUrl(null);
    } else {
      void fetch('/api/clinic/logo', { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (cancelled || !b) return;
          setLogoUrl(URL.createObjectURL(b));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [settings.branding.hasLogo, settings.branding.logoContentType]);

  useEffect(() => {
    let cancelled = false;
    if (!settings.branding.hasSignature) {
      setSigUrl(null);
    } else {
      void fetch('/api/clinic/signature', { credentials: 'include' })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (cancelled || !b) return;
          setSigUrl(URL.createObjectURL(b));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [settings.branding.hasSignature]);

  async function pickLogo(): Promise<void> {
    logoInput.current?.click();
  }
  async function onLogoFile(file: File): Promise<void> {
    if (file.size > 2 * 1024 * 1024) {
      onToast('Logo nuk mund të kalojë 2 MB.', 'error');
      return;
    }
    if (file.type !== 'image/png' && file.type !== 'image/svg+xml') {
      onToast('Vetëm PNG ose SVG.', 'error');
      return;
    }
    setBusy('logo');
    try {
      const dataBase64 = await fileToBase64(file);
      const next = await clinicClient.uploadLogo({
        contentType: file.type as 'image/png' | 'image/svg+xml',
        dataBase64,
      });
      onChange(next);
      onToast('Logo u ngarkua.');
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Ngarkimi dështoi.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function removeLogo(): Promise<void> {
    setBusy('logo');
    try {
      const next = await clinicClient.removeLogo();
      onChange(next);
      onToast('Logo u hoq.');
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Heqja dështoi.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function onSigFile(file: File): Promise<void> {
    if (file.size > 1 * 1024 * 1024) {
      onToast('Nënshkrimi nuk mund të kalojë 1 MB.', 'error');
      return;
    }
    if (file.type !== 'image/png') {
      onToast('Vetëm PNG (sfond transparent).', 'error');
      return;
    }
    setBusy('signature');
    try {
      const dataBase64 = await fileToBase64(file);
      const next = await clinicClient.uploadSignature({ contentType: 'image/png', dataBase64 });
      onChange(next);
      onToast('Nënshkrimi u ngarkua.');
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Ngarkimi dështoi.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function removeSig(): Promise<void> {
    setBusy('signature');
    try {
      const next = await clinicClient.removeSignature();
      onChange(next);
      onToast('Nënshkrimi u hoq.');
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Heqja dështoi.', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <FormGrid>
      <FieldLabel>Logo</FieldLabel>
      <div className="flex items-center gap-3.5">
        <div className="h-16 w-16 rounded-lg bg-teal-50 border border-teal-200 grid place-items-center overflow-hidden font-display font-semibold text-teal-800 text-lg">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="Logo e klinikës" className="h-full w-full object-contain" />
          ) : (
            settings.general.shortName.slice(0, 2).toUpperCase()
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={pickLogo} disabled={busy === 'logo'}>
              {settings.branding.hasLogo ? 'Ndrysho' : 'Ngarko'}
            </Button>
            {settings.branding.hasLogo ? (
              <Button variant="ghost" size="sm" onClick={removeLogo} disabled={busy === 'logo'}>
                Hiq
              </Button>
            ) : null}
          </div>
          <span className="text-[12px] text-stone-400">PNG ose SVG · max 2 MB</span>
        </div>
        <input
          ref={logoInput}
          type="file"
          accept="image/png,image/svg+xml"
          className="hidden"
          data-testid="logo-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onLogoFile(f);
            e.target.value = '';
          }}
        />
      </div>

      <FieldLabel>Nënshkrimi i skanuar</FieldLabel>
      <div className="flex items-center gap-3.5">
        <div className="h-16 w-24 rounded-lg bg-stone-50 border border-dashed border-stone-300 grid place-items-center text-stone-400 italic overflow-hidden">
          {sigUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sigUrl} alt="Nënshkrimi" className="h-full w-full object-contain" />
          ) : (
            'pa nënshkrim'
          )}
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => sigInput.current?.click()}
              disabled={busy === 'signature'}
            >
              {settings.branding.hasSignature ? 'Ndrysho' : 'Ngarko'}
            </Button>
            {settings.branding.hasSignature ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={removeSig}
                disabled={busy === 'signature'}
              >
                Hiq
              </Button>
            ) : null}
          </div>
          <span className="text-[12px] text-stone-400">
            PNG me sfond transparent · ruhet i koduar
          </span>
        </div>
        <input
          ref={sigInput}
          type="file"
          accept="image/png"
          className="hidden"
          data-testid="signature-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onSigFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </FormGrid>
  );
}
