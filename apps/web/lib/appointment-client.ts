import { apiFetch, apiUrl } from './api';

// ---------------------------------------------------------------------------
// Wire shapes — keep aligned with
//   apps/api/src/modules/appointments/appointments.dto.ts
// ---------------------------------------------------------------------------

export type AppointmentStatus = 'scheduled' | 'completed' | 'no_show' | 'cancelled';

export interface AppointmentDto {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  /** ISO instant (UTC). */
  scheduledFor: string;
  durationMinutes: number;
  status: AppointmentStatus;
  /** ISO yyyy-mm-dd of the patient's most recent visit, or null. */
  lastVisitAt: string | null;
  isNewPatient: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentListResponse {
  appointments: AppointmentDto[];
  serverTime: string;
}

export interface AppointmentStatsResponse {
  date: string;
  total: number;
  completed: number;
  noShow: number;
  scheduled: number;
  cancelled: number;
  firstStart: string | null;
  lastEnd: string | null;
  nextAppointment: {
    id: string;
    patient: { firstName: string; lastName: string; dateOfBirth: string | null };
    scheduledFor: string;
    durationMinutes: number;
  } | null;
}

export interface CreateAppointmentInput {
  patientId: string;
  date: string; // yyyy-mm-dd
  time: string; // HH:MM
  durationMinutes: number;
}

export interface UpdateAppointmentInput {
  date?: string;
  time?: string;
  durationMinutes?: number;
  status?: AppointmentStatus;
}

export const appointmentClient = {
  list: (from: string, to: string) =>
    apiFetch<AppointmentListResponse>(
      `/api/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),

  stats: (date: string) =>
    apiFetch<AppointmentStatsResponse>(
      `/api/appointments/stats?date=${encodeURIComponent(date)}`,
    ),

  unmarkedPast: () =>
    apiFetch<{ appointments: AppointmentDto[] }>('/api/appointments/unmarked-past'),

  create: (input: CreateAppointmentInput) =>
    apiFetch<{ appointment: AppointmentDto }>('/api/appointments', {
      method: 'POST',
      json: input,
    }),

  update: (id: string, input: UpdateAppointmentInput) =>
    apiFetch<{ appointment: AppointmentDto }>(`/api/appointments/${id}`, {
      method: 'PATCH',
      json: input,
    }),

  softDelete: (id: string) =>
    apiFetch<{ status: 'ok'; restorableUntil: string }>(`/api/appointments/${id}`, {
      method: 'DELETE',
    }),

  restore: (id: string) =>
    apiFetch<{ appointment: AppointmentDto }>(`/api/appointments/${id}/restore`, {
      method: 'POST',
    }),

  streamUrl: () => apiUrl('/api/appointments/stream'),
};

// ---------------------------------------------------------------------------
// Pure helpers (no React, no DOM) — also exercised in unit tests.
// ---------------------------------------------------------------------------

export type LastVisitColor = 'green' | 'yellow' | 'red' | null;

/**
 * Color chip rule (mirrors the API helper of the same name):
 *   - null lastVisit → no chip
 *   - 0–7 days ago   → red    (very recent)
 *   - 7–30 days ago  → yellow
 *   - > 30 days ago  → green
 */
export function colorIndicatorForLastVisit(
  lastVisitAt: string | null,
  asOf: Date = new Date(),
): LastVisitColor {
  if (!lastVisitAt) return null;
  const last = new Date(lastVisitAt);
  if (Number.isNaN(last.getTime())) return null;
  const ms = asOf.getTime() - last.getTime();
  if (ms < 0) return null;
  const days = ms / 86_400_000;
  if (days <= 7) return 'red';
  if (days <= 30) return 'yellow';
  return 'green';
}

export const BELGRADE_TZ = 'Europe/Belgrade';

const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: BELGRADE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

export interface LocalParts {
  date: string;
  time: string;
  weekday: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
}

export function toLocalParts(instant: Date): LocalParts {
  const parts = Object.fromEntries(PARTS_FMT.formatToParts(instant).map((p) => [p.type, p.value]));
  const weekdayMap: Record<string, LocalParts['weekday']> = {
    Mon: 'mon',
    Tue: 'tue',
    Wed: 'wed',
    Thu: 'thu',
    Fri: 'fri',
    Sat: 'sat',
    Sun: 'sun',
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: weekdayMap[parts.weekday ?? ''] ?? 'mon',
  };
}

export function startOfLocalDay(dateIso: string): Date {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  // Same algorithm as the API's `localClockToUtc`. We don't want a
  // date-fns dependency here either.
  const naive = Date.UTC(y, m - 1, d);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: BELGRADE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date(naive)).map((p) => [p.type, p.value]),
  );
  const tzClock = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(naive - (tzClock - naive));
}

const DAY_LABELS_SHORT: Record<LocalParts['weekday'], string> = {
  mon: 'Hën',
  tue: 'Mar',
  wed: 'Mër',
  thu: 'Enj',
  fri: 'Pre',
  sat: 'Sht',
  sun: 'Die',
};
const DAY_LABELS_LONG: Record<LocalParts['weekday'], string> = {
  mon: 'E hënë',
  tue: 'E martë',
  wed: 'E mërkurë',
  thu: 'E enjte',
  fri: 'E premte',
  sat: 'E shtunë',
  sun: 'E diel',
};
const MONTHS_LONG = [
  'janar',
  'shkurt',
  'mars',
  'prill',
  'maj',
  'qershor',
  'korrik',
  'gusht',
  'shtator',
  'tetor',
  'nëntor',
  'dhjetor',
];

export function dayLabelShort(weekday: LocalParts['weekday']): string {
  return DAY_LABELS_SHORT[weekday];
}
export function dayLabelLong(weekday: LocalParts['weekday']): string {
  return DAY_LABELS_LONG[weekday];
}

export function formatLongAlbanianDate(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  const dow = order[utc.getUTCDay()] ?? 'mon';
  return `${dayLabelLong(dow)}, ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

export function formatRangeAlbanian(fromIso: string, toIso: string): string {
  const [yf, mf, df] = fromIso.split('-').map(Number) as [number, number, number];
  const [yt, mt, dt] = toIso.split('-').map(Number) as [number, number, number];
  const monthSame = mf === mt && yf === yt;
  if (monthSame) {
    return `${df} — ${dt} ${MONTHS_LONG[mf - 1]} ${yf}`;
  }
  return `${df} ${MONTHS_LONG[mf - 1]} — ${dt} ${MONTHS_LONG[mt - 1]} ${yt}`;
}

export function todayIsoLocal(now: Date = new Date()): string {
  return toLocalParts(now).date;
}

export function addLocalDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() + days);
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function weekdayOf(dateIso: string): LocalParts['weekday'] {
  const [y, m, d] = dateIso.split('-').map(Number) as [number, number, number];
  const utc = new Date(Date.UTC(y, m - 1, d));
  const order = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
  return order[utc.getUTCDay()] ?? 'mon';
}

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatDob(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '—';
  return `${d}.${m}.${y}`;
}
