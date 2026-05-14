'use client';

import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import {
  clinicClient,
  type ClinicSettings,
  type PaymentCode,
  type PaymentCodes,
  formatEuro,
} from '@/lib/clinic-client';
import { InfoTip, PaneHeader } from './section-card';

interface Props {
  settings: ClinicSettings;
  onChange: (next: ClinicSettings) => void;
  onToast: (msg: string, tone?: 'success' | 'error') => void;
}

type EditingState =
  | { key: string; label: string; amountStr: string }
  | null;

export function PaymentsTab({ settings, onChange, onToast }: Props) {
  const [codes, setCodes] = useState<PaymentCodes>(() => ({ ...settings.paymentCodes }));
  const [editing, setEditing] = useState<EditingState>(null);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCodes({ ...settings.paymentCodes });
  }, [settings.paymentCodes]);

  const orderedKeys = Object.keys(codes).sort();

  async function persist(next: PaymentCodes, message: string): Promise<void> {
    setBusy(true);
    try {
      const updated = await clinicClient.updatePaymentCodes(next);
      onChange(updated);
      onToast(message);
    } catch (err: unknown) {
      onToast(err instanceof ApiError ? err.message : 'Ruajtja dështoi.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    const amount = parseEuroToCents(editing.amountStr);
    if (amount === null) {
      onToast('Çmim i pavlefshëm.', 'error');
      return;
    }
    if (editing.label.trim().length === 0) {
      onToast('Përshkrimi mungon.', 'error');
      return;
    }
    const next: PaymentCodes = { ...codes, [editing.key]: { label: editing.label.trim(), amountCents: amount } };
    setEditing(null);
    await persist(next, `Kodi ${editing.key} u ruajt.`);
  }

  async function addCode(): Promise<void> {
    const key = newKey.trim().toUpperCase();
    if (!/^[A-Z]$/.test(key)) {
      onToast('Kodi duhet të jetë një shkronjë A–Z.', 'error');
      return;
    }
    if (codes[key]) {
      onToast(`Kodi ${key} ekziston tashmë.`, 'error');
      return;
    }
    const amount = parseEuroToCents(newAmount);
    if (amount === null) {
      onToast('Çmim i pavlefshëm.', 'error');
      return;
    }
    if (newLabel.trim().length === 0) {
      onToast('Përshkrimi mungon.', 'error');
      return;
    }
    const next: PaymentCodes = { ...codes, [key]: { label: newLabel.trim(), amountCents: amount } };
    setAdding(false);
    setNewKey('');
    setNewLabel('');
    setNewAmount('');
    await persist(next, `Kodi ${key} u shtua.`);
  }

  return (
    <>
      <PaneHeader
        title="Kodet e pagesave"
        description="Kode të shkurtra që mjeku zgjedh gjatë vizitës. Vetëm mjeku i sheh — nuk shfaqen për recepsion ose pacient."
      />

      <div className="bg-white border border-stone-200 rounded-xl shadow-xs overflow-hidden">
        <table className="w-full" data-testid="codes-table">
          <thead>
            <tr className="bg-stone-50 border-b border-stone-200">
              <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3 w-20">
                Kodi
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3">
                Përshkrimi
              </th>
              <th className="text-left text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3 w-36">
                Çmimi
              </th>
              <th className="text-right text-[11px] uppercase tracking-wider font-semibold text-stone-500 px-4 py-3 w-32">
                Veprimi
              </th>
            </tr>
          </thead>
          <tbody>
            {orderedKeys.map((key) => {
              const code: PaymentCode = codes[key]!;
              const isEditing = editing?.key === key;
              return (
                <tr key={key} className={isEditing ? 'bg-stone-50' : 'border-b border-stone-100 last:border-0'}>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex h-7 w-7 items-center justify-center bg-teal-100 text-teal-800 rounded font-display font-semibold text-[14px]">
                      {key}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-[13px] text-stone-700">
                    {isEditing ? (
                      <Input
                        value={editing.label}
                        onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                        data-testid={`code-label-${key}`}
                      />
                    ) : (
                      code.label
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-[13px] font-mono text-stone-900 font-medium">
                    {isEditing ? (
                      <Input
                        value={editing.amountStr}
                        onChange={(e) => setEditing({ ...editing, amountStr: e.target.value })}
                        className="font-mono"
                        data-testid={`code-amount-${key}`}
                      />
                    ) : (
                      formatEuro(code.amountCents)
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {isEditing ? (
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                          Anulo
                        </Button>
                        <Button size="sm" onClick={saveEdit} disabled={busy} data-testid={`code-save-${key}`}>
                          Ruaj
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setEditing({
                            key,
                            label: code.label,
                            amountStr: (code.amountCents / 100).toString(),
                          })
                        }
                        data-testid={`code-edit-${key}`}
                      >
                        Modifiko
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}

            {adding ? (
              <tr className="bg-stone-50">
                <td className="px-4 py-3.5">
                  <Input
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    maxLength={1}
                    className="w-12 text-center font-display font-semibold text-[14px]"
                    placeholder="X"
                    data-testid="new-code-key"
                  />
                </td>
                <td className="px-4 py-3.5">
                  <Input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="Përshkrimi"
                    data-testid="new-code-label"
                  />
                </td>
                <td className="px-4 py-3.5">
                  <Input
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="0"
                    className="font-mono"
                    data-testid="new-code-amount"
                  />
                </td>
                <td className="px-4 py-3.5 text-right">
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                      Anulo
                    </Button>
                    <Button size="sm" onClick={addCode} disabled={busy}>
                      Shto
                    </Button>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        <div className="px-4 py-3 bg-stone-50 border-t border-stone-200 flex justify-end">
          {!adding ? (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              + Shto kod
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-5">
        <InfoTip>
          Ndryshimet aplikohen për vizitat e reja. Vizitat ekzistuese mbajnë çmimin e tyre origjinal
          për integritetin financiar.
        </InfoTip>
      </div>
    </>
  );
}

function parseEuroToCents(input: string): number | null {
  const cleaned = input.trim().replace(/€/g, '').replace(/,/g, '.').replace(/\s/g, '');
  if (cleaned.length === 0) return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}
