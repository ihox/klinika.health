'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MasterDataStrip } from '@/components/patient/master-data-strip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { isPatientComplete } from '@/lib/patient';
import {
  patientClient,
  type DoctorPatientInput,
  type PatientFullDto,
} from '@/lib/patient-client';

type Mode = 'create' | 'edit';

interface Props {
  mode: Mode;
  patient?: PatientFullDto;
  onSaved: (patient: PatientFullDto) => void;
  onCancel: () => void;
  /**
   * Edit-mode only. Fires when a save transitions the patient from
   * incomplete to complete (per `isPatientComplete`). The te-dhena
   * page wires this to a router.push back to the chart.
   *
   * Saves on an already-complete patient (subsequent edits) do NOT
   * fire this — the doctor came back to edit, not to complete.
   */
  onCompleted?: (patient: PatientFullDto) => void;
}

interface FormState {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: '' | 'm' | 'f';
  placeOfBirth: string;
  phone: string;
  birthWeightG: string;
  birthLengthCm: string;
  birthHeadCircumferenceCm: string;
  alergjiTjera: string;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1500;

/**
 * Doctor's full patient master-data form.
 *
 * Mode "create" — collects all fields, single Save button at the
 * bottom. No auto-save until the record exists.
 *
 * Mode "edit"  — auto-save per CLAUDE.md §5.4:
 *   - 1.5s debounce after the last keystroke
 *   - immediate save on field blur
 *   - immediate save on the manual Save button
 *   - visible indicator: Idle / Dirty / Saving / Saved / Error
 *
 * Field-level errors and the save indicator surface inline so the
 * doctor never doubts whether their work is captured.
 */
export function PatientFullForm({
  mode,
  patient,
  onSaved,
  onCancel,
  onCompleted,
}: Props) {
  const [form, setForm] = useState<FormState>(() => buildInitial(patient));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Keep a ref of the latest snapshot so the debounced auto-save
  // always reads the most recent state without re-binding the timer.
  const formRef = useRef(form);
  formRef.current = form;
  const lastSavedRef = useRef(form);
  const debounceRef = useRef<number | null>(null);
  // Tracks whether the patient was incomplete when the form mounted.
  // Drives the "completed" transition callback — saving on an
  // already-complete patient (the doctor came back to edit) must NOT
  // re-fire navigation back to the chart.
  const wasIncompleteOnEntryRef = useRef<boolean>(
    patient ? !patient.isComplete : false,
  );

  // When the parent swaps in a different patient (different id), reset
  // local state so we never write one patient's changes onto another.
  // We deliberately depend only on the id, not the full patient object —
  // server-driven updates of the same patient should not blow away
  // unsaved edits the doctor is mid-typing.
  useEffect(() => {
    setForm(buildInitial(patient));
    setSaveState('idle');
    setErrorMsg(null);
    lastSavedRef.current = buildInitial(patient);
    wasIncompleteOnEntryRef.current = patient ? !patient.isComplete : false;
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient?.id]);

  const runUpdate = useCallback(async () => {
    if (!patient) return;
    const snapshot = formRef.current;
    if (snapshotsEqual(snapshot, lastSavedRef.current)) {
      setSaveState('saved');
      return;
    }
    const payload = snapshotToPayload(snapshot);
    setSaveState('saving');
    try {
      const res = await patientClient.update(patient.id, payload);
      lastSavedRef.current = snapshot;
      setSaveState('saved');
      setErrorMsg(null);
      onSaved(res.patient);
      // Fire the completion-transition callback exactly when a
      // previously-incomplete patient becomes complete via this save.
      // Once fired, flip the latch so subsequent saves on the same
      // mount don't re-navigate (the doctor may stay on the form to
      // edit additional fields after the transition).
      if (wasIncompleteOnEntryRef.current && res.patient.isComplete) {
        wasIncompleteOnEntryRef.current = false;
        onCompleted?.(res.patient);
      }
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? formatApiError(err)
          : 'Ruajtja dështoi. Provoni përsëri.';
      setErrorMsg(msg);
      setSaveState('error');
    }
  }, [patient, onSaved, onCompleted]);

  // Auto-save in edit mode: debounce 1.5s after each change.
  useEffect(() => {
    if (mode !== 'edit') return;
    if (saveState === 'saving') return;
    if (snapshotsEqual(form, lastSavedRef.current)) {
      // No effective change; stay idle/saved.
      return;
    }
    setSaveState('dirty');
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      void runUpdate();
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [form, mode, runUpdate, saveState]);

  // Auto-save on tab close / navigation — best effort.
  useEffect(() => {
    if (mode !== 'edit') return;
    const handler = () => {
      // Synchronous so it actually fires before unload. Fetch keepalive
      // ensures the request survives navigation.
      if (snapshotsEqual(formRef.current, lastSavedRef.current)) return;
      const payload = snapshotToPayload(formRef.current);
      try {
        const body = JSON.stringify(payload);
        navigator.sendBeacon?.(`/api/patients/${patient!.id}`, new Blob([body], { type: 'application/json' }));
      } catch {
        // beacon failures are silent; the data also persists via the
        // 1.5s debounce, so this is purely a tail-of-life safety net.
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, patient?.id]);

  const handleField = (field: keyof FormState) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const blurSave = () => {
    if (mode !== 'edit') return;
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void runUpdate();
  };

  const handleCreate = useCallback(async () => {
    if (creating) return;
    setErrorMsg(null);
    const payload = snapshotToPayload(form);
    if (
      !payload.firstName ||
      !payload.lastName ||
      !payload.dateOfBirth ||
      !payload.sex
    ) {
      setErrorMsg('Emri, mbiemri, datelindja dhe gjinia janë të detyrueshme.');
      return;
    }
    setCreating(true);
    try {
      const res = await patientClient.createFull(payload as DoctorPatientInput);
      onSaved(res.patient);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? formatApiError(err)
          : 'Krijimi dështoi. Provoni përsëri.';
      setErrorMsg(msg);
    } finally {
      setCreating(false);
    }
  }, [creating, form, onSaved]);

  const indicator = useMemo(() => SAVE_INDICATORS[saveState], [saveState]);
  // All four required fields populated? Drives the Save button gate.
  // Mirrors `isPatientComplete` (the server-side flag) so the doctor
  // sees the same truth on the form as on the chart.
  const formIsComplete = useMemo(
    () =>
      isPatientComplete({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        dateOfBirth: form.dateOfBirth,
        sex: form.sex,
      }),
    [form.firstName, form.lastName, form.dateOfBirth, form.sex],
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-6 py-3.5">
        <div>
          <h2 className="text-[16px] font-semibold text-stone-900">
            {mode === 'create' ? 'Pacient i ri' : `${form.firstName || '—'} ${form.lastName || ''}`}
          </h2>
          {mode === 'edit' ? (
            <div
              className={`mt-0.5 inline-flex items-center gap-1.5 text-[12px] ${indicator.cls}`}
              role="status"
              aria-live="polite"
              data-testid="patient-save-state"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${indicator.dot}`} aria-hidden />
              {indicator.label}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Mbyll
          </Button>
          {mode === 'create' ? (
            <Button
              onClick={handleCreate}
              disabled={creating || !formIsComplete}
              title={
                !formIsComplete
                  ? 'Plotëso emrin, mbiemrin, datëlindjen dhe gjininë'
                  : undefined
              }
            >
              {creating ? 'Po ruhet…' : 'Ruaj'}
            </Button>
          ) : (
            <Button
              onClick={() => {
                void runUpdate();
              }}
              disabled={!formIsComplete}
              title={
                !formIsComplete
                  ? 'Plotëso emrin, mbiemrin, datëlindjen dhe gjininë'
                  : undefined
              }
            >
              Ruaj
            </Button>
          )}
        </div>
      </header>

      {mode === 'edit' && patient ? (
        <div className="border-b border-stone-100 px-6 py-3">
          <MasterDataStrip patient={patient} />
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {errorMsg ? (
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
            {errorMsg}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Emri" required>
            <Input
              value={form.firstName}
              onChange={(e) => handleField('firstName')(e.target.value)}
              onBlur={blurSave}
            />
          </Field>
          <Field label="Mbiemri" required>
            <Input
              value={form.lastName}
              onChange={(e) => handleField('lastName')(e.target.value)}
              onBlur={blurSave}
            />
          </Field>

          <Field label="Datelindja" required>
            <Input
              type="date"
              value={form.dateOfBirth}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => handleField('dateOfBirth')(e.target.value)}
              onBlur={blurSave}
            />
          </Field>
          <Field label="Gjinia" required>
            <select
              value={form.sex}
              onChange={(e) => handleField('sex')(e.target.value)}
              onBlur={blurSave}
              className="block h-10 w-full rounded-md border border-stone-200 bg-white px-3 text-[14px] text-stone-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            >
              <option value="">—</option>
              <option value="f">Femër</option>
              <option value="m">Mashkull</option>
            </select>
          </Field>

          <Field label="Vendi i lindjes">
            <Input
              value={form.placeOfBirth}
              onChange={(e) => handleField('placeOfBirth')(e.target.value)}
              onBlur={blurSave}
              placeholder="p.sh. Prizren"
            />
          </Field>
          <Field label="Telefoni">
            <Input
              value={form.phone}
              onChange={(e) => handleField('phone')(e.target.value)}
              onBlur={blurSave}
              placeholder="+383 ..."
              inputMode="tel"
            />
          </Field>
        </div>

        <h3 className="mt-7 mb-2 text-[12px] font-medium uppercase tracking-wide text-stone-500">
          Të dhënat e lindjes
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Pesha (g)">
            <Input
              type="number"
              min={0}
              step={10}
              value={form.birthWeightG}
              onChange={(e) => handleField('birthWeightG')(e.target.value)}
              onBlur={blurSave}
              inputMode="numeric"
            />
          </Field>
          <Field label="Gjatësia (cm)">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={form.birthLengthCm}
              onChange={(e) => handleField('birthLengthCm')(e.target.value)}
              onBlur={blurSave}
              inputMode="decimal"
            />
          </Field>
          <Field label="PK (cm)">
            <Input
              type="number"
              min={0}
              step={0.1}
              value={form.birthHeadCircumferenceCm}
              onChange={(e) => handleField('birthHeadCircumferenceCm')(e.target.value)}
              onBlur={blurSave}
              inputMode="decimal"
            />
          </Field>
        </div>

        <h3 className="mt-7 mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-wide text-stone-500">
          <span
            aria-hidden
            className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700"
          >
            !
          </span>
          Alergji / Tjera
          <span className="ml-1 normal-case tracking-normal text-stone-400">
            (vetëm për doktorin — nuk printohet)
          </span>
        </h3>
        <textarea
          value={form.alergjiTjera}
          onChange={(e) => handleField('alergjiTjera')(e.target.value)}
          onBlur={blurSave}
          rows={3}
          maxLength={2000}
          placeholder="Alergji, gjendje kronike, sjellje, etj."
          className="block w-full rounded-md border border-amber-200 bg-amber-50/30 px-3 py-2 text-[14px] text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30"
        />
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium uppercase tracking-wide text-stone-500">
        {label}
        {required ? <span className="ml-0.5 text-amber-700">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function buildInitial(patient: PatientFullDto | undefined): FormState {
  if (!patient) {
    return {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      sex: '',
      placeOfBirth: '',
      phone: '',
      birthWeightG: '',
      birthLengthCm: '',
      birthHeadCircumferenceCm: '',
      alergjiTjera: '',
    };
  }
  return {
    firstName: patient.firstName,
    lastName: patient.lastName,
    dateOfBirth: patient.dateOfBirth ?? '',
    sex: patient.sex ?? '',
    placeOfBirth: patient.placeOfBirth ?? '',
    phone: patient.phone ?? '',
    birthWeightG: patient.birthWeightG?.toString() ?? '',
    birthLengthCm: patient.birthLengthCm?.toString() ?? '',
    birthHeadCircumferenceCm: patient.birthHeadCircumferenceCm?.toString() ?? '',
    alergjiTjera: patient.alergjiTjera ?? '',
  };
}

function snapshotToPayload(form: FormState): DoctorPatientInput {
  const payload: DoctorPatientInput = {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    dateOfBirth: form.dateOfBirth,
  };
  if (form.sex === 'm' || form.sex === 'f') payload.sex = form.sex;
  if (form.placeOfBirth.trim()) payload.placeOfBirth = form.placeOfBirth.trim();
  if (form.phone.trim()) payload.phone = form.phone.trim();
  const w = parseNumber(form.birthWeightG);
  if (w != null) payload.birthWeightG = Math.round(w);
  const l = parseNumber(form.birthLengthCm);
  if (l != null) payload.birthLengthCm = l;
  const h = parseNumber(form.birthHeadCircumferenceCm);
  if (h != null) payload.birthHeadCircumferenceCm = h;
  if (form.alergjiTjera.trim()) payload.alergjiTjera = form.alergjiTjera.trim();
  return payload;
}

function parseNumber(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function snapshotsEqual(a: FormState, b: FormState): boolean {
  return (
    a.firstName.trim() === b.firstName.trim() &&
    a.lastName.trim() === b.lastName.trim() &&
    a.dateOfBirth === b.dateOfBirth &&
    a.sex === b.sex &&
    a.placeOfBirth.trim() === b.placeOfBirth.trim() &&
    a.phone.trim() === b.phone.trim() &&
    a.birthWeightG.trim() === b.birthWeightG.trim() &&
    a.birthLengthCm.trim() === b.birthLengthCm.trim() &&
    a.birthHeadCircumferenceCm.trim() === b.birthHeadCircumferenceCm.trim() &&
    a.alergjiTjera.trim() === b.alergjiTjera.trim()
  );
}

function formatApiError(err: ApiError): string {
  if (err.body.message) return err.body.message;
  return `Gabim ${err.status}`;
}

const SAVE_INDICATORS: Record<SaveState, { label: string; cls: string; dot: string }> = {
  idle: { label: 'I rregullt', cls: 'text-stone-400', dot: 'bg-stone-300' },
  dirty: { label: 'Pa ruajtur', cls: 'text-amber-700', dot: 'bg-amber-500' },
  saving: { label: 'Po ruhet…', cls: 'text-stone-500', dot: 'bg-stone-400 animate-pulse' },
  saved: { label: 'Ruajtur', cls: 'text-emerald-700', dot: 'bg-emerald-500' },
  error: { label: 'Gabim', cls: 'text-amber-700', dot: 'bg-amber-500' },
};
