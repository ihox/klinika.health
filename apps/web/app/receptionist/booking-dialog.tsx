'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import {
  appointmentClient,
  formatDob,
  formatLongAlbanianDate,
} from '@/lib/appointment-client';
import type { HoursConfig } from '@/lib/clinic-client';
import type { PatientPublicDto } from '@/lib/patient-client';

export interface BookingDialogProps {
  patient: PatientPublicDto;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  hours: HoursConfig;
  onClose: () => void;
  onBooked: () => void;
  onError: (msg: string) => void;
}

export function BookingDialog({
  patient,
  date,
  time,
  hours,
  onClose,
  onBooked,
  onError,
}: BookingDialogProps): ReactElement {
  const [duration, setDuration] = useState<number>(hours.defaultDuration);
  const [submitting, setSubmitting] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const initials = `${patient.firstName.charAt(0)}${patient.lastName.charAt(0)}`.toUpperCase();

  const durations = useMemo(() => {
    return Array.from(new Set(hours.durations)).sort((a, b) => a - b);
  }, [hours.durations]);

  // Esc to close
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !submitting) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, submitting]);

  const submit = async (): Promise<void> => {
    setSubmitting(true);
    setConflictMsg(null);
    try {
      await appointmentClient.create({
        patientId: patient.id,
        date,
        time,
        durationMinutes: duration,
      });
      onBooked();
    } catch (err) {
      if (err instanceof ApiError) {
        const message = err.body.message ?? 'Caktimi dështoi.';
        if (err.body.reason === 'conflict' || err.body.reason === 'after_close') {
          setConflictMsg(message);
        } else {
          onError(message);
        }
      } else {
        onError('Diçka shkoi keq.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="flex w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-modal">
        <header className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
          <h3 id="booking-title" className="font-display text-[17px] font-semibold text-ink-strong">
            Cakto termin
          </h3>
          <button
            type="button"
            aria-label="Mbyll"
            disabled={submitting}
            className="grid h-8 w-8 place-items-center rounded text-[22px] leading-none text-ink-muted hover:bg-surface-subtle hover:text-ink"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="grid gap-4 px-5 pt-4 pb-1">
          <div className="rounded-md border border-line-soft bg-surface-subtle px-3.5 py-3">
            <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
              Pacienti
            </div>
            <div className="flex items-center gap-3">
              <div className="grid h-9.5 w-9.5 place-items-center rounded-full bg-teal-700 font-display text-[14px] font-semibold text-white">
                {initials}
              </div>
              <div>
                <div className="font-display text-[15px] font-semibold text-ink-strong">
                  {patient.firstName} {patient.lastName}
                </div>
                <div className="text-[12px] text-ink-muted tabular-nums">
                  DL {formatDob(patient.dateOfBirth)}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
                Data
              </span>
              <input
                value={formatLongAlbanianDate(date)}
                readOnly
                className="rounded-md border border-line-strong bg-surface-subtle px-3 py-2 text-[14px] tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
                Ora
              </span>
              <input
                value={time}
                readOnly
                className="rounded-md border border-line-strong bg-surface-subtle px-3 py-2 text-[14px] tabular-nums"
              />
            </div>
          </div>

          <div>
            <div className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
              Kohëzgjatja
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {durations.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDuration(d)}
                  className={cn(
                    'flex h-16 items-center justify-between rounded-md border-[1.5px] bg-surface-elevated px-4 py-3 text-left transition',
                    duration === d
                      ? 'border-primary bg-teal-50'
                      : 'border-line-strong hover:border-teal-300 hover:bg-teal-50/60',
                  )}
                  aria-pressed={duration === d}
                >
                  <span
                    className={cn(
                      'font-display text-[22px] font-semibold tabular-nums',
                      duration === d ? 'text-primary-dark' : 'text-ink-strong',
                    )}
                  >
                    {d}
                    <span className="ml-1 font-sans text-[13px] font-medium text-ink-muted">
                      min
                    </span>
                  </span>
                  <span
                    className={cn(
                      'relative h-5 w-5 rounded-full border-[1.5px]',
                      duration === d
                        ? 'border-primary bg-primary'
                        : 'border-line-strong bg-surface-elevated',
                    )}
                    aria-hidden
                  >
                    {duration === d ? (
                      <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {conflictMsg ? (
            <div className="rounded-md border border-warning-soft bg-warning-bg/40 px-3.5 py-2.5 text-[12.5px] text-warning">
              {conflictMsg}
            </div>
          ) : null}
        </div>

        <footer className="mt-2 flex justify-end gap-2 border-t border-line-soft bg-surface-subtle px-5 py-3.5">
          <Button variant="ghost" disabled={submitting} onClick={onClose}>
            Anulo
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? 'Po caktohet…' : 'Cakto termin'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
