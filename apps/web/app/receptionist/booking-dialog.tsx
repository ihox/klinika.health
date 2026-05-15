'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApiError } from '@/lib/api';
import {
  formatDob,
  minutesToTime,
  timeToMinutes,
} from '@/lib/appointment-client';
import {
  type AvailabilityOption,
  type CalendarEntry,
  calendarClient,
} from '@/lib/visits-calendar-client';
import type { DayKey, HoursConfig } from '@/lib/clinic-client';
import type { PatientPublicDto } from '@/lib/patient-client';
import { patientInitials } from '@/lib/patient-client';

const TIME_STEP_MIN = 10;
const DAY_ORDER: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export interface BookingDialogResult {
  entry: CalendarEntry;
  /** What the receptionist sees as the toast message. */
  toast: string;
}

export interface BookingDialogProps {
  /** When `mode === 'edit'`, also pass the existing appointment id. */
  mode: 'create' | 'edit';
  appointmentId?: string;
  patient: PatientPublicDto;
  /** Date the dialog opens with — pre-filled regardless of path. */
  initialDate: string;
  /** Time the dialog opens with — empty string for Path 2. */
  initialTime: string;
  initialDurationMinutes?: number;
  hours: HoursConfig;
  /** Whether the date/time stubs render with the teal "prefilled" tint. */
  prefilledFromSlot?: boolean;
  onClose: () => void;
  onBooked: (result: BookingDialogResult) => void;
  onError: (msg: string) => void;
}

/**
 * The single source of truth for booking and rescheduling.
 *
 * Both flow paths converge here:
 *   - Path 1 (slot-first):  date + time pre-filled from the tapped slot.
 *   - Path 2 (patient-first): date pre-filled to today, time empty.
 *   - Edit (existing appt):  every field pre-filled; PATCH on submit.
 *
 * Duration is NEVER pre-selected on create — the receptionist must
 * actively choose one. Per the design prototype, this is a deliberate
 * friction point to prevent zero-thought defaults.
 *
 * Availability is fetched from `/api/appointments/availability` and
 * re-fetched whenever date or time changes. The duration grid renders
 * three states per option (`fits` / `extends` / `blocked`) matching the
 * three prototype frames.
 */
export function BookingDialog({
  mode,
  appointmentId,
  patient,
  initialDate,
  initialTime,
  initialDurationMinutes,
  hours,
  prefilledFromSlot = false,
  onClose,
  onBooked,
  onError,
}: BookingDialogProps): ReactElement {
  const [date, setDate] = useState<string>(initialDate);
  const [time, setTime] = useState<string>(initialTime);
  const [duration, setDuration] = useState<number | null>(initialDurationMinutes ?? null);
  const [availability, setAvailability] = useState<AvailabilityOption[]>([]);
  const [availabilityError, setAvailabilityError] = useState(false);
  // Bumped to force the availability effect to re-run on a Retry click.
  // Date/time changes already trigger a re-run via their own deps.
  const [availabilityRetryToken, setAvailabilityRetryToken] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const initials = patientInitials(patient);

  // Esc to close (unless we're in the middle of a network request).
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

  // Pull availability whenever the (date, time) anchor changes. Skip
  // when time is empty (Path 2 before the receptionist picks an hour).
  //
  // On ApiError (5xx, network, stale schema), we do NOT silently mark
  // every duration as blocked — that masquerades as a closed-day or a
  // permissions problem. Instead, surface a dedicated error state and
  // let the receptionist retry. Every fetch attempt clears the previous
  // error first, so a successful retry (or a date/time change) wipes it.
  useEffect(() => {
    let cancelled = false;
    if (!time) {
      setAvailability([]);
      setAvailabilityError(false);
      return;
    }
    setAvailabilityError(false);
    (async () => {
      try {
        const res = await calendarClient.availability({
          date,
          time,
          excludeVisitId: mode === 'edit' ? appointmentId : undefined,
        });
        if (!cancelled) setAvailability(res.options);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setAvailability([]);
          setAvailabilityError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appointmentId, availabilityRetryToken, date, mode, patient.id, time]);

  const retryAvailability = useCallback(() => {
    setAvailabilityRetryToken((n) => n + 1);
  }, []);

  // When the receptionist changes time after picking a duration, drop
  // the selection — they must reaffirm. This is the same friction the
  // design notes call out: "Ndryshimi i orës rivendos gjendjen."
  const onTimeChange = useCallback(
    (next: string) => {
      setTime(next);
      setDuration(null);
      setServerError(null);
    },
    [],
  );
  const onDateChange = useCallback((next: string) => {
    setDate(next);
    setDuration(null);
    setServerError(null);
  }, []);

  // Auto-reset duration if the currently-selected one becomes blocked.
  useEffect(() => {
    if (duration == null) return;
    const opt = availability.find((o) => o.durationMinutes === duration);
    if (opt && opt.status === 'blocked') {
      setDuration(null);
    }
  }, [availability, duration]);

  const selectedOption = useMemo(
    () => (duration != null ? availability.find((o) => o.durationMinutes === duration) ?? null : null),
    [availability, duration],
  );

  const canSubmit =
    !submitting &&
    time !== '' &&
    duration != null &&
    selectedOption != null &&
    selectedOption.status !== 'blocked';

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const dur = duration!;
      if (mode === 'create') {
        const res = await calendarClient.createScheduled({
          patientId: patient.id,
          date,
          time,
          durationMinutes: dur,
        });
        onBooked({
          entry: res.entry,
          toast: formatBookingToast(date, time, dur),
        });
      } else {
        if (!appointmentId) {
          throw new Error('Edit mode requires appointmentId');
        }
        const res = await calendarClient.reschedule(appointmentId, {
          date,
          time,
          durationMinutes: dur,
        });
        onBooked({
          entry: res.entry,
          toast: formatRescheduleToast(date, time, dur),
        });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const message = err.body.message ?? 'Caktimi dështoi.';
        if (err.body.reason === 'conflict') {
          setServerError('Ky orar mbivendoset me një termin tjetër.');
        } else if (err.body.reason === 'after_close') {
          setServerError('Termini kalon orarin e mbylljes.');
        } else if (err.body.reason === 'before_open') {
          setServerError('Ora është para hapjes së klinikës.');
        } else if (err.body.reason === 'closed_day') {
          setServerError('Klinika është e mbyllur këtë ditë.');
        } else {
          onError(message);
        }
      } else {
        onError('Diçka shkoi keq.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [appointmentId, canSubmit, date, duration, mode, onBooked, onError, patient.id, time]);

  // Time picker options: every 10 minutes within the chosen day's
  // working hours. Falls back to 10:00–18:00 for closed-day cases so
  // the dropdown is never empty.
  const timeOptions = useMemo(() => buildTimeOptions(hours, date), [hours, date]);
  const dateLabel = useMemo(() => formatShortDate(date), [date]);

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
      <div className="flex w-full max-w-[480px] flex-col overflow-hidden rounded-lg border border-line bg-surface-elevated shadow-modal">
        <header className="flex items-center justify-between gap-3 border-b border-line-soft px-5 py-4">
          <h3 id="booking-title" className="font-display text-[17px] font-semibold text-ink-strong">
            {mode === 'edit' ? 'Riprogramo terminin' : 'Cakto termin'}
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
          {/* Patient — read-only, even in edit mode */}
          <div className="rounded-md border border-line-soft bg-surface-subtle px-3.5 py-3">
            <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
              Pacienti
            </div>
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-teal-700 font-display text-[14px] font-semibold text-white">
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

          {/* Date + Time */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
                Data
              </span>
              <input
                type="date"
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                className={cn(
                  'rounded-md border px-3 py-2 text-[14px] tabular-nums outline-none focus:ring-2',
                  prefilledFromSlot
                    ? 'border-teal-300 bg-teal-50 text-teal-900 focus:border-primary focus:ring-primary/25'
                    : 'border-line-strong bg-surface-elevated focus:border-primary focus:ring-primary/25',
                )}
                aria-label={`Data, parazgjedhur ${dateLabel}`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
                Ora
              </span>
              <select
                value={time}
                onChange={(e) => onTimeChange(e.target.value)}
                className={cn(
                  'rounded-md border px-3 py-2 text-[14px] tabular-nums outline-none focus:ring-2',
                  time && prefilledFromSlot
                    ? 'border-teal-300 bg-teal-50 text-teal-900 focus:border-primary focus:ring-primary/25'
                    : time
                      ? 'border-line-strong bg-surface-elevated focus:border-primary focus:ring-primary/25'
                      : 'border-line-strong bg-surface-elevated italic text-ink-faint focus:border-primary focus:ring-primary/25',
                )}
                aria-label="Ora"
              >
                <option value="">Zgjidh orarin...</option>
                {timeOptions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Duration grid */}
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-muted">
                Kohëzgjatja
              </span>
              {duration == null && time !== '' && !availabilityError ? (
                <span className="font-mono text-[10px] lowercase text-ink-faint">· zgjidhe</span>
              ) : null}
            </div>
            {availabilityError ? (
              <div
                role="alert"
                aria-live="polite"
                className="flex items-start gap-2.5 rounded-md border border-amber-300 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-[1.5] text-amber-900"
              >
                <WarnIcon className="mt-0.5 flex-none text-warning" />
                <div className="flex-1">
                  <div className="font-semibold">
                    Nuk u ngarkuan kohëzgjatjet. Provo përsëri.
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-amber-800/80">
                    Lidhja me serverin dështoi. Kontrollo internetin dhe provo
                    përsëri.
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={retryAvailability}
                  className="flex-none border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                >
                  Provo përsëri
                </Button>
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {(time === '' ? hoursToFallback(hours) : availability).map((opt) => {
                const isSelected = duration === opt.durationMinutes;
                const isBlocked = opt.status === 'blocked';
                return (
                  <button
                    key={opt.durationMinutes}
                    type="button"
                    disabled={isBlocked || time === ''}
                    onClick={() => {
                      if (isBlocked) return;
                      setDuration(opt.durationMinutes);
                      setServerError(null);
                    }}
                    aria-pressed={isSelected}
                    aria-disabled={isBlocked || time === ''}
                    data-availability={opt.status}
                    className={cn(
                      'flex h-[60px] items-center justify-between rounded-md border-[1.5px] px-4 text-left transition',
                      isSelected && !isBlocked
                        ? 'border-primary bg-teal-50'
                        : isBlocked
                          ? 'border-dashed border-line bg-surface-subtle cursor-not-allowed'
                          : time === ''
                            ? 'border-line-strong bg-surface-elevated cursor-not-allowed opacity-60'
                            : 'border-line-strong bg-surface-elevated hover:border-teal-300 hover:bg-teal-50/60',
                    )}
                  >
                    <span
                      className={cn(
                        'font-display text-[20px] font-semibold tabular-nums',
                        isSelected && !isBlocked
                          ? 'text-primary-dark'
                          : isBlocked
                            ? 'text-ink-faint'
                            : 'text-ink-strong',
                      )}
                    >
                      {opt.durationMinutes}
                      <span
                        className={cn(
                          'ml-1 font-sans text-[12px] font-medium',
                          isBlocked ? 'text-ink-faint' : 'text-ink-muted',
                        )}
                      >
                        min
                      </span>
                    </span>
                    <span
                      className={cn(
                        'relative h-5 w-5 rounded-full border-[1.5px]',
                        isSelected && !isBlocked
                          ? 'border-primary bg-primary'
                          : isBlocked
                            ? 'border-dashed border-line-strong bg-surface-elevated'
                            : 'border-line-strong bg-surface-elevated',
                      )}
                      aria-hidden
                    >
                      {isSelected && !isBlocked ? (
                        <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            )}

            {/* Inline notices — extend (info) and blocked (warn) */}
            {time && selectedOption?.status === 'extends' ? (
              <div
                role="status"
                className="mt-2.5 flex items-start gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2.5 text-[12px] leading-[1.55] text-teal-900"
              >
                <ExtendIcon className="mt-0.5 text-primary" />
                <div>
                  Ky termin do të zgjasë deri <strong>{selectedOption.endsAt}</strong>. Të vazhdojmë?
                </div>
              </div>
            ) : null}

            {time && availability.some((o) => o.status === 'blocked' && o.reason === 'conflict') ? (
              <div
                role="status"
                className="mt-2.5 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] leading-[1.55] text-amber-900"
              >
                <WarnIcon className="mt-0.5 text-warning" />
                <div>
                  <strong>Kjo kohëzgjatje nuk është e disponueshme në këtë orar.</strong>
                  <div className="mt-0.5 text-[11.5px] opacity-80">
                    Zgjidh një kohëzgjatje më të shkurtër ose ndrysho orarin.
                  </div>
                </div>
              </div>
            ) : null}

            {serverError ? (
              <div
                role="alert"
                className="mt-2.5 rounded-md border border-warning-soft bg-warning-bg/40 px-3 py-2.5 text-[12px] text-warning"
              >
                {serverError}
              </div>
            ) : null}
          </div>
        </div>

        <footer className="mt-2 flex justify-end gap-2 border-t border-line-soft bg-surface-subtle px-5 py-3.5">
          <Button variant="ghost" disabled={submitting} onClick={onClose}>
            Anulo
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {submitting
              ? 'Po caktohet…'
              : mode === 'edit'
                ? 'Ruaj ndryshimet'
                : 'Cakto termin'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hoursToFallback(hours: HoursConfig): AvailabilityOption[] {
  // Used before the user picks a time. Every option is shown but
  // visually disabled (no availability data yet). The dialog also
  // disables the entire grid via the `time === ''` branch above.
  return hours.durations
    .slice()
    .sort((a, b) => a - b)
    .map((d) => ({
      durationMinutes: d,
      status: 'fits' as const,
      endsAt: null,
      reason: null,
    }));
}

function buildTimeOptions(hours: HoursConfig, dateIso: string): string[] {
  const dow = weekdayKeyOf(dateIso);
  const day = hours.days[dow];
  const startMin = day.open ? timeToMinutes(day.start) : timeToMinutes('10:00');
  const endMin = day.open ? timeToMinutes(day.end) : timeToMinutes('18:00');
  const out: string[] = [];
  for (let m = startMin; m + TIME_STEP_MIN <= endMin; m += TIME_STEP_MIN) {
    out.push(minutesToTime(m));
  }
  return out;
}

function weekdayKeyOf(dateIso: string): DayKey {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  return DAY_ORDER[(utc.getUTCDay() + 6) % 7] ?? 'mon';
}

const MONTHS_SHORT = [
  'jan',
  'shk',
  'mar',
  'pri',
  'maj',
  'qer',
  'kor',
  'gus',
  'sht',
  'tet',
  'nën',
  'dhj',
];

function formatShortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS_SHORT[(m - 1) % 12]}`;
}

export function formatBookingToast(date: string, time: string, duration: number): string {
  return `Termini u caktua për ${formatShortDate(date)}, ora ${time} (${duration} min)`;
}

export function formatRescheduleToast(date: string, time: string, duration: number): string {
  return `Termini u zhvendos në ${formatShortDate(date)}, ora ${time} (${duration} min)`;
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs, no asset pipeline
// ---------------------------------------------------------------------------

function ExtendIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 7v4M8 5h.01" strokeLinecap="round" />
    </svg>
  );
}

function WarnIcon({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden
    >
      <path d="M8 1.5L14.5 13.5h-13z" strokeLinejoin="round" />
      <path d="M8 6.5v3.5M8 12h.01" strokeLinecap="round" />
    </svg>
  );
}
