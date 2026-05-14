'use client';

import { useEffect, useState, type ReactElement } from 'react';

import { ApiError } from '@/lib/api';
import {
  patientClient,
  type PatientFullDto,
} from '@/lib/patient-client';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  patient: PatientFullDto;
  onClose: () => void;
  onSaved: (updated: PatientFullDto) => void;
}

/**
 * Compact dialog that lets the doctor set a patient's biological sex
 * without leaving the chart. Triggered from the growth-chart panel
 * when the sex can't be resolved from the master record or first
 * name.
 *
 * Storage is the same `PATCH /api/patients/:id` endpoint used for
 * the master-data edit screen — this dialog is just a focused
 * one-field surface. Once saved, the chart re-renders with the
 * correct WHO curves and color tone.
 */
export function SetSexDialog({
  open,
  patient,
  onClose,
  onSaved,
}: Props): ReactElement | null {
  const [choice, setChoice] = useState<'m' | 'f' | null>(patient.sex);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setChoice(patient.sex);
      setError(null);
    }
  }, [open, patient.sex]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function save() {
    if (choice == null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await patientClient.update(patient.id, { sex: choice });
      onSaved(res.patient);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Ruajtja dështoi. Provoni përsëri.';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="set-sex-title"
      className="fixed inset-0 z-modal flex items-center justify-center bg-[rgba(28,25,23,0.5)] p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[420px] animate-modal-in rounded-lg border border-line bg-surface-elevated shadow-modal">
        <header className="border-b border-line-soft px-5 pb-3 pt-4">
          <h2
            id="set-sex-title"
            className="m-0 font-display text-[16px] font-semibold tracking-snug text-ink-strong"
          >
            Cakto gjininë e pacientit
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Grafikët WHO përdorin kurba të ndryshme për djem dhe vajza.
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3 px-5 py-4">
          <SexOption
            value="m"
            label="Djalë"
            selected={choice === 'm'}
            tone="male"
            onClick={() => setChoice('m')}
          />
          <SexOption
            value="f"
            label="Vajzë"
            selected={choice === 'f'}
            tone="female"
            onClick={() => setChoice('f')}
          />
        </div>

        {error ? (
          <p
            role="alert"
            className="mx-5 mb-3 rounded-sm border border-danger-soft bg-danger-bg px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 items-center rounded-sm border border-line bg-surface-elevated px-3 text-[12.5px] font-medium text-ink-strong hover:bg-surface-subtle"
            disabled={saving}
          >
            Anulo
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={choice == null || saving}
            data-testid="set-sex-save"
            className="inline-flex h-8 items-center rounded-sm border border-transparent bg-primary px-3 text-[12.5px] font-medium text-white shadow-btn-primary-inset hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Duke ruajtur…' : 'Ruaj'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function SexOption({
  value,
  label,
  selected,
  tone,
  onClick,
}: {
  value: 'm' | 'f';
  label: string;
  selected: boolean;
  tone: 'male' | 'female';
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      data-testid={`set-sex-option-${value}`}
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'flex flex-col items-center gap-1 rounded-md border-2 px-3 py-4 text-[13px] font-medium transition-colors',
        selected
          ? tone === 'male'
            ? 'border-chart-male bg-chart-male-soft text-chart-male-strong'
            : 'border-chart-female bg-chart-female-soft text-chart-female-strong'
          : 'border-line bg-surface-elevated text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'block h-3 w-3 rounded-full',
          selected
            ? tone === 'male'
              ? 'bg-chart-male'
              : 'bg-chart-female'
            : 'bg-line-strong',
        )}
      />
      {label}
    </button>
  );
}
