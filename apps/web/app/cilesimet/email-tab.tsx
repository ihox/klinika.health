'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { clinicClient, type ClinicSettings, type SmtpUpdate } from '@/lib/clinic-client';
import { FieldLabel, FormGrid, InfoTip, PaneHeader, SectionCard } from './section-card';

interface Props {
  settings: ClinicSettings;
  onChange: (next: ClinicSettings) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

interface SmtpForm {
  host: string;
  port: number;
  username: string;
  password: string; // empty means "use stored"
  fromName: string;
  fromAddress: string;
}

function buildForm(settings: ClinicSettings): SmtpForm {
  return {
    host: settings.email.smtp?.host ?? '',
    port: settings.email.smtp?.port ?? 587,
    username: settings.email.smtp?.username ?? '',
    password: '',
    fromName: settings.email.smtp?.fromName ?? settings.general.shortName,
    fromAddress: settings.email.smtp?.fromAddress ?? settings.general.email,
  };
}

export function EmailTab({ settings, onChange, onToast }: Props) {
  const [mode, setMode] = useState<'default' | 'smtp'>(settings.email.mode);
  const [form, setForm] = useState<SmtpForm>(() => buildForm(settings));
  const [testTarget, setTestTarget] = useState<string>(settings.general.email);
  const [testResult, setTestResult] = useState<
    { ok: boolean; detail: string } | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMode(settings.email.mode);
    setForm(buildForm(settings));
    setTestTarget(settings.general.email);
    setTestResult(null);
  }, [settings]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const payload: SmtpUpdate =
        mode === 'default'
          ? { mode: 'default' }
          : {
              mode: 'smtp',
              host: form.host,
              port: form.port,
              username: form.username,
              password: form.password ? form.password : undefined,
              fromName: form.fromName,
              fromAddress: form.fromAddress,
            };
      const next = await clinicClient.updateEmail(payload);
      onChange(next);
      onToast(
        next.email.mode === 'smtp' ? 'SMTP-ja u ruajt.' : 'U vendos në default.',
      );
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Ruajtja dështoi.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function runTest(): Promise<void> {
    if (mode !== 'smtp') return;
    setTesting(true);
    setTestResult(null);
    try {
      const out = await clinicClient.testEmail({
        mode: 'smtp',
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password ? form.password : undefined,
        fromName: form.fromName,
        fromAddress: form.fromAddress,
        toEmail: testTarget,
      });
      setTestResult({ ok: out.ok, detail: out.detail });
      onToast(
        out.ok ? 'SMTP-ja u testua me sukses.' : 'Testimi dështoi — shih detajet.',
        out.ok ? 'success' : 'error',
      );
    } catch (err: unknown) {
      const message = err instanceof ApiError ? err.message : 'Testimi dështoi.';
      setTestResult({ ok: false, detail: message });
      onToast(message, 'error');
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <PaneHeader
        title="Email"
        description="Si dërgohen vërtetimet, kujtesat dhe linket për reset të fjalëkalimit."
      />

      <SectionCard
        title="Mënyra e dërgimit"
        description="Zgjidhni një opsion. Mund të ndryshohet në çdo kohë."
        actions={
          <>
            <Button variant="ghost" onClick={() => setForm(buildForm(settings))} disabled={saving}>
              Anulo
            </Button>
            <Button onClick={save} disabled={saving} data-testid="email-save">
              {saving ? 'Po ruhet…' : 'Ruaj'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <RadioCard
            selected={mode === 'default'}
            onClick={() => setMode('default')}
            title="Default i Klinika"
            description={
              <>
                Email-et dërgohen përmes infrastrukturës së Klinika nga{' '}
                <span className="font-mono">noreply@klinika.health</span>. Pa konfigurim.
              </>
            }
            badge="I rekomanduar"
            data-testid="email-mode-default"
          />
          <RadioCard
            selected={mode === 'smtp'}
            onClick={() => setMode('smtp')}
            title="Konfiguro SMTP-në tuaj"
            description="Email-et dërgohen nga adresa e klinikës. Kërkon kredenciale SMTP nga ofruesi juaj (Google Workspace, Zoho, etj.)."
            data-testid="email-mode-smtp"
          >
            <div className="mt-4 pt-4 border-t border-teal-200">
              <FormGrid>
                <FieldLabel>Host</FieldLabel>
                <Input
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="smtp.gmail.com"
                  data-testid="smtp-host"
                />
                <FieldLabel>Port</FieldLabel>
                <Input
                  type="number"
                  value={form.port}
                  onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
                  className="font-mono w-32"
                  data-testid="smtp-port"
                />
                <FieldLabel>Username</FieldLabel>
                <Input
                  value={form.username}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  data-testid="smtp-username"
                />
                <FieldLabel>Password</FieldLabel>
                <div>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder={
                      settings.email.smtp?.passwordSet ? '•••••••• (ruajtur)' : ''
                    }
                    data-testid="smtp-password"
                  />
                  {settings.email.smtp?.passwordSet ? (
                    <div className="text-[12px] text-stone-400 mt-1">
                      Lëre bosh për të ruajtur fjalëkalimin ekzistues.
                    </div>
                  ) : null}
                </div>
                <FieldLabel>Emri i dërguesit</FieldLabel>
                <Input
                  value={form.fromName}
                  onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                />
                <FieldLabel>Adresa dërguese</FieldLabel>
                <Input
                  value={form.fromAddress}
                  onChange={(e) => setForm({ ...form, fromAddress: e.target.value })}
                />
                <FieldLabel>Email i testit</FieldLabel>
                <Input
                  value={testTarget}
                  onChange={(e) => setTestTarget(e.target.value)}
                  placeholder="ti@email.com"
                />
              </FormGrid>

              <div className="mt-3 flex items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={runTest}
                  disabled={testing}
                  data-testid="smtp-test"
                >
                  {testing ? 'Po testohet…' : 'Testo lidhjen'}
                </Button>
                {testResult ? (
                  <span
                    className={`text-[12px] font-medium ${
                      testResult.ok ? 'text-emerald-700' : 'text-amber-800'
                    }`}
                    data-testid="smtp-test-result"
                  >
                    {testResult.ok ? '✓' : '⚠'} {testResult.detail}
                  </span>
                ) : null}
              </div>

              <div className="mt-4">
                <InfoTip>
                  Nëse SMTP-ja juaj dështon në runtime, Klinika do të planifikojë rikthim
                  automatik te default-i për të mos humbur asnjë email kritik. Çdo dështim
                  shfaqet në audit log.
                </InfoTip>
              </div>
            </div>
          </RadioCard>
        </div>
      </SectionCard>
    </>
  );
}

function RadioCard({
  selected,
  onClick,
  title,
  description,
  badge,
  children,
  ...rest
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: React.ReactNode;
  badge?: string;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      onClick={onClick}
      className={`flex flex-col px-4 py-4 rounded-md border transition-all cursor-pointer ${
        selected ? 'border-teal-500 bg-teal-50 shadow-[0_0_0_3px_rgba(13,148,136,0.1)]' : 'border-stone-300 hover:border-stone-400 bg-white'
      }`}
      {...rest}
    >
      <div className="flex items-start gap-3">
        <input
          type="radio"
          checked={selected}
          readOnly
          className="accent-teal-600 mt-1"
        />
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-stone-900">{title}</div>
          <div className="text-[12px] text-stone-500 mt-0.5">{description}</div>
        </div>
        {badge ? (
          <span className="text-[10.5px] uppercase tracking-wide font-semibold text-teal-800 bg-teal-100 border border-teal-200 px-2 py-0.5 rounded-full">
            {badge}
          </span>
        ) : null}
      </div>
      {selected ? children : null}
    </label>
  );
}
