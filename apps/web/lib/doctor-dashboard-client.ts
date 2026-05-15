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
