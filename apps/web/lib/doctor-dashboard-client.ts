import { apiFetch } from './api';

// ---------------------------------------------------------------------------
// Wire shapes — keep aligned with
//   apps/api/src/modules/doctor-dashboard/doctor-dashboard.dto.ts
// ---------------------------------------------------------------------------

export type DashboardAppointmentPosition =
  | 'current'
  | 'next'
  | 'upcoming'
  | 'past';

export type DashboardAppointmentStatus =
  | 'scheduled'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'no_show'
  | 'cancelled';

export interface DashboardAppointment {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  /** ISO instant of the booked time, or null for walk-ins. */
  scheduledFor: string | null;
  /** ISO instant of patient arrival; set for walk-ins and any
   *  scheduled booking that has transitioned to status >= 'arrived'. */
  arrivedAt: string | null;
  isWalkIn: boolean;
  durationMinutes: number;
  status: DashboardAppointmentStatus;
  position: DashboardAppointmentPosition;
}

export interface DashboardVisitLogEntry {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  recordedAt: string;
  primaryDiagnosis: {
    code: string;
    latinDescription: string;
  } | null;
  paymentCode: string | null;
  paymentAmountCents: number | null;
}

/**
 * "Vizita të hapura" entry — an `in_progress` visit from a prior local
 * day that the doctor never marked completed. Surfaced at the top of
 * the dashboard so the backlog can be cleared before today's queue
 * begins. Mirror of `DashboardOpenVisitEntry` on the API side.
 */
export interface DashboardOpenVisit {
  id: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
  };
  visitDate: string;
  daysAgo: number;
}

export interface DashboardNextPatientCard {
  appointmentId: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    sex: 'm' | 'f' | null;
  };
  /** For scheduled bookings: the booked time. For walk-in targets: the
   *  arrival time. Always non-null so the card's hero clock works. */
  scheduledFor: string;
  isWalkIn: boolean;
  durationMinutes: number;
  visitCount: number;
  lastVisitDate: string | null;
  daysSinceLastVisit: number | null;
  lastDiagnosis: {
    code: string;
    latinDescription: string;
  } | null;
  lastWeightG: number | null;
  hasAllergyNote: boolean;
}

export interface DashboardStats {
  visitsCompleted: number;
  appointmentsTotal: number;
  appointmentsCompleted: number;
  averageVisitMinutes: number | null;
  paymentsCents: number;
}

export interface DoctorDashboardResponse {
  date: string;
  serverTime: string;
  appointments: DashboardAppointment[];
  todayVisits: DashboardVisitLogEntry[];
  /**
   * `in_progress` visits from prior local days. Empty array when the
   * backlog is clear; the panel hides itself when so.
   */
  openVisits: DashboardOpenVisit[];
  nextPatient: DashboardNextPatientCard | null;
  stats: DashboardStats;
}

export const doctorDashboardClient = {
  get: (): Promise<DoctorDashboardResponse> =>
    apiFetch<DoctorDashboardResponse>('/api/doctor/dashboard'),
};

// ---------------------------------------------------------------------------
// Pure helpers (also unit-tested)
// ---------------------------------------------------------------------------

export type DoctorGreeting =
  | 'Mirëmëngjes'
  | 'Mirëdita'
  | 'Mirëmbrëma'
  | 'Natë e mbarë';

const BELGRADE_TZ = 'Europe/Belgrade';

/**
 * Mirror of the API's `greetingForInstant` helper — kept here too so
 * the dashboard renders the correct greeting before its first
 * payload arrives. Both sides converge on the same hour because they
 * both anchor to Europe/Belgrade.
 */
export function greetingForInstant(
  instant: Date = new Date(),
  tz: string = BELGRADE_TZ,
): DoctorGreeting {
  const hour = belgradeHour(instant, tz);
  if (hour >= 5 && hour < 12) return 'Mirëmëngjes';
  if (hour >= 12 && hour < 18) return 'Mirëdita';
  if (hour >= 18 && hour < 23) return 'Mirëmbrëma';
  return 'Natë e mbarë';
}

function belgradeHour(instant: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const part = fmt.formatToParts(instant).find((p) => p.type === 'hour');
  const value = part ? Number(part.value) : NaN;
  if (Number.isNaN(value)) return 0;
  return value;
}

export function formatEuros(cents: number): string {
  if (cents === 0) return '0 €';
  const value = cents / 100;
  if (Number.isInteger(value)) return `${value} €`;
  return `${value.toFixed(2)} €`;
}

export function formatPaymentLabel(
  entry: Pick<DashboardVisitLogEntry, 'paymentCode' | 'paymentAmountCents'>,
): string {
  if (entry.paymentCode == null) return '—';
  if (entry.paymentAmountCents == null) {
    return entry.paymentCode;
  }
  return `${entry.paymentCode} · ${formatEuros(entry.paymentAmountCents)}`;
}

// Albanian month names — kept local to the helpers that produce row
// labels. The receptionist date formatters in appointment-client.ts
// hold a private copy; if a third call site appears the array should
// move to a shared module.
const MONTHS_AL = [
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
] as const;

/**
 * Row label for an "Vizita të hapura" entry:
 *
 *   "13 maj 2026 · dje"
 *   "10 maj 2026 · 4 ditë më parë"
 *
 * The date part is intentionally short (no weekday) — the relative
 * description already carries the recency signal, and a long weekday
 * label competes with the patient name on the row.
 */
export function formatOpenVisitLabel(
  entry: Pick<DashboardOpenVisit, 'visitDate' | 'daysAgo'>,
): string {
  const [y, m, d] = entry.visitDate.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const monthName = MONTHS_AL[m - 1] ?? '';
  const dateStr = `${d} ${monthName} ${y}`;
  const relative =
    entry.daysAgo === 1 ? 'dje' : `${entry.daysAgo} ditë më parë`;
  return `${dateStr} · ${relative}`;
}

export type DaysSinceColor = 'green' | 'yellow' | 'red' | 'neutral';

/**
 * Color band for "X days since last visit". Mirrors the calendar's
 * lastVisit chip rule (CLAUDE.md slice-08) but inverted: a very
 * recent visit is reassuring on the home dashboard, while a long
 * absence may warrant a callback.
 *
 *   null     → neutral (new patient — no history)
 *   0–7 d    → green   (recent — patient is well-tracked)
 *   8–30 d   → yellow
 *   > 30 d   → red     (overdue follow-up)
 */
export function daysSinceColor(
  days: number | null,
): DaysSinceColor {
  if (days == null) return 'neutral';
  if (days <= 7) return 'green';
  if (days <= 30) return 'yellow';
  return 'red';
}
