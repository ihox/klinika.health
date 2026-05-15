import { Injectable } from '@nestjs/common';

import { localDateToday, utcMidnight } from '../../common/datetime';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  localClockToUtc,
  utcToLocalParts,
} from '../visits/visits-calendar.tz';
import { parsePaymentCodesOrDefault } from '../clinic-settings/clinic-settings.service';
import type { PaymentCodes } from '../clinic-settings/clinic-settings.dto';
import {
  type DashboardAppointmentDto,
  type DashboardAppointmentStatus,
  type DashboardNextPatientCard,
  type DashboardOpenVisitEntry,
  type DashboardVisitLogEntry,
  type DoctorDashboardResponse,
} from './doctor-dashboard.dto';
import { classifyAppointments } from './doctor-dashboard.classify';
import { computeDayStats } from './doctor-dashboard.stats';

const DASHBOARD_APPOINTMENT_STATUSES: readonly DashboardAppointmentStatus[] = [
  'scheduled',
  'arrived',
  'in_progress',
  'completed',
  'no_show',
  'cancelled',
];

/**
 * Narrow the unified `visits.status` TEXT column to the dashboard's
 * status enum. Post Phase 2b every value in the CHECK constraint is
 * exposed verbatim — walk-ins surface 'arrived' / 'in_progress' so the
 * doctor's day view can distinguish them. An unknown value falls back
 * to 'scheduled' (defensive).
 */
function narrowDashboardStatus(value: string): DashboardAppointmentStatus {
  if ((DASHBOARD_APPOINTMENT_STATUSES as readonly string[]).includes(value)) {
    return value as DashboardAppointmentStatus;
  }
  return 'scheduled';
}

const UNKNOWN_DOB_ISO = '1900-01-01';

/**
 * Assembles the doctor's "Pamja e ditës" snapshot.
 *
 * One service call → one Postgres round-trip per resource (clinic
 * config, appointments, today's visits, the next-patient context).
 * No `$queryRaw` — Prisma's `findMany` + a `groupBy` cover everything.
 *
 * The dashboard is doctor-only; the controller enforces the role
 * (`@Roles('doctor', 'clinic_admin')`) and RLS is the defense in
 * depth.
 */
@Injectable()
export class DoctorDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(
    clinicId: string,
    ctx: RequestContext,
    overrideDate: string | undefined,
  ): Promise<DoctorDashboardResponse> {
    void ctx;
    const now = new Date();
    const today = overrideDate ?? localDateToday();
    // Appointments are Timestamptz; visit_date is @db.Date. Each gets
    // the operand type Postgres expects — mixing them caused the
    // dashboard "today's visits" bug fixed in ADR-006.
    const dayStartUtc = localClockToUtc(today, '00:00');
    const dayEndUtc = new Date(dayStartUtc.getTime() + 86_400_000);

    // Pad ±24h so DST-day boundaries don't drop appointments stored
    // close to midnight local; we filter back to the requested local
    // day in JS.
    const dayQueryStart = new Date(dayStartUtc.getTime() - 86_400_000);
    const dayQueryEnd = new Date(dayEndUtc.getTime() + 86_400_000);

    const [clinic, rawAppointments, visits, openVisitRows] = await Promise.all([
      this.prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { paymentCodes: true },
      }),
      // Appointments view: scheduled bookings anchored on `scheduled_for`,
      // PLUS walk-ins anchored on `arrived_at` (Phase 2b — walk-ins fold
      // into the doctor's day list with an `isWalkIn` marker on each row).
      // Post-merge (ADR-011) both flavours live in `visits`; the OR
      // predicate pulls them together in one round-trip.
      this.prisma.visit.findMany({
        where: {
          clinicId,
          deletedAt: null,
          OR: [
            {
              scheduledFor: { gte: dayQueryStart, lte: dayQueryEnd, not: null },
            },
            {
              isWalkIn: true,
              arrivedAt: { gte: dayQueryStart, lte: dayQueryEnd, not: null },
            },
          ],
        },
        orderBy: [{ scheduledFor: 'asc' }, { arrivedAt: 'asc' }],
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
        },
      }),
      // Today's visit log: clinical visits with payment + diagnoses,
      // anchored on `visit_date`. Restricted to `status='completed'`
      // so scheduled-but-not-yet-seen rows don't appear in the log.
      this.prisma.visit.findMany({
        where: {
          clinicId,
          deletedAt: null,
          status: 'completed',
          visitDate: utcMidnight(today),
        },
        orderBy: { createdAt: 'asc' },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
          diagnoses: {
            orderBy: { orderIndex: 'asc' },
            include: {
              code: {
                select: { code: true, latinDescription: true },
              },
            },
            take: 1,
          },
        },
      }),
      // "Vizita të hapura" — `in_progress` visits anchored to a local
      // day prior to today. These are abandoned charts that the doctor
      // started but never marked completed; surfacing them lets the
      // doctor finish (or delete) the backlog before today's queue
      // begins. `visit_date` is `@db.Date`, so the operand is a
      // UTC-midnight Date per ADR-006.
      this.prisma.visit.findMany({
        where: {
          clinicId,
          deletedAt: null,
          status: 'in_progress',
          visitDate: { lt: utcMidnight(today) },
        },
        orderBy: { visitDate: 'asc' },
        include: {
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              dateOfBirth: true,
            },
          },
        },
      }),
    ]);

    const paymentCodes = parsePaymentCodesOrDefault(clinic?.paymentCodes);
    const paymentAmount = (code: string): number | null =>
      paymentCodes[code]?.amountCents ?? null;

    // Post-merge: `scheduledFor`, `durationMinutes` and the TEXT
    // `status` column are all schema-nullable / loosely typed. The
    // anchor for a row is `scheduledFor` (booking) or `arrivedAt`
    // (walk-in); rows missing both are dropped. Sorting is by the
    // anchor so walk-ins interleave with bookings chronologically.
    const appointments = rawAppointments
      .map((a) => {
        const anchor = a.scheduledFor ?? a.arrivedAt;
        return anchor ? { row: a, anchor } : null;
      })
      .filter(
        (v): v is { row: (typeof rawAppointments)[number]; anchor: Date } =>
          v !== null && utcToLocalParts(v.anchor).date === today,
      )
      .sort((a, b) => a.anchor.getTime() - b.anchor.getTime())
      .map(({ row, anchor }) => ({
        id: row.id,
        patientId: row.patientId,
        scheduledFor: row.scheduledFor,
        arrivedAt: row.arrivedAt,
        isWalkIn: row.isWalkIn,
        durationMinutes: row.durationMinutes ?? 0,
        status: narrowDashboardStatus(row.status),
        patient: row.patient,
        anchor,
      }));

    const dashboardAppointments = classifyAppointments(appointments, now);

    const nextPatient = await this.buildNextPatientCard({
      clinicId,
      appointments: dashboardAppointments,
      now,
    });

    const todayVisits: DashboardVisitLogEntry[] = visits.map((v) => ({
      id: v.id,
      patientId: v.patientId,
      patient: {
        firstName: v.patient.firstName,
        lastName: v.patient.lastName,
        dateOfBirth: serializeDob(v.patient.dateOfBirth),
      },
      recordedAt: v.createdAt.toISOString(),
      primaryDiagnosis: v.diagnoses[0]
        ? {
            code: v.diagnoses[0].code.code,
            latinDescription: v.diagnoses[0].code.latinDescription,
          }
        : null,
      paymentCode: v.paymentCode ?? null,
      paymentAmountCents: v.paymentCode ? paymentAmount(v.paymentCode) : null,
    }));

    const stats = computeDayStats({
      visits: visits.map((v) => ({
        paymentCode: v.paymentCode ?? null,
        createdAt: v.createdAt,
      })),
      appointments: appointments.map((a) => ({ status: a.status })),
      paymentAmount,
    });

    const openVisits: DashboardOpenVisitEntry[] = openVisitRows.map((v) => {
      const visitDateIso = toIsoDate(v.visitDate) ?? today;
      return {
        id: v.id,
        patientId: v.patientId,
        patient: {
          firstName: v.patient.firstName,
          lastName: v.patient.lastName,
          dateOfBirth: serializeDob(v.patient.dateOfBirth),
        },
        visitDate: visitDateIso,
        daysAgo: Math.max(1, daysBetween(visitDateIso, today)),
      };
    });

    return {
      date: today,
      serverTime: now.toISOString(),
      appointments: dashboardAppointments,
      todayVisits,
      openVisits,
      nextPatient,
      stats,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  // Position classifier lives in `doctor-dashboard.classify.ts` as a
  // pure function so it can be unit-tested without Prisma.

  /**
   * The next-patient card pulls in chart context the appointment row
   * alone can't provide (sex, alergjiTjera, prior visit data). All
   * of it stays scoped to `clinicId` and RLS — the helper just
   * coalesces three small lookups behind one card.
   */
  private async buildNextPatientCard(opts: {
    clinicId: string;
    appointments: DashboardAppointmentDto[];
    now: Date;
  }): Promise<DashboardNextPatientCard | null> {
    const { clinicId, appointments } = opts;
    const target =
      appointments.find((a) => a.position === 'current') ??
      appointments.find((a) => a.position === 'next');
    if (!target) return null;

    const [patient, lastVisit, visitCount] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { id: target.patientId, clinicId, deletedAt: null },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          sex: true,
          alergjiTjera: true,
        },
      }),
      // "Last visit" and visit count drive the doctor's at-a-glance
      // patient context — both must reflect completed clinical visits
      // only. Post-merge a scheduled (future) row also lives in
      // `visits`; we filter it out via `status='completed'`.
      this.prisma.visit.findFirst({
        where: {
          clinicId,
          patientId: target.patientId,
          deletedAt: null,
          status: 'completed',
        },
        orderBy: { visitDate: 'desc' },
        select: {
          id: true,
          visitDate: true,
          weightG: true,
          diagnoses: {
            orderBy: { orderIndex: 'asc' },
            include: {
              code: { select: { code: true, latinDescription: true } },
            },
            take: 1,
          },
        },
      }),
      this.prisma.visit.count({
        where: {
          clinicId,
          patientId: target.patientId,
          deletedAt: null,
          status: 'completed',
        },
      }),
    ]);
    if (!patient) return null;

    const lastVisitDateIso = lastVisit
      ? toIsoDate(lastVisit.visitDate)
      : null;
    const daysSinceLastVisit = lastVisitDateIso
      ? daysBetween(lastVisitDateIso, utcToLocalParts(opts.now).date)
      : null;
    const lastDiagnosis =
      lastVisit && lastVisit.diagnoses[0]
        ? {
            code: lastVisit.diagnoses[0].code.code,
            latinDescription: lastVisit.diagnoses[0].code.latinDescription,
          }
        : null;
    // For walk-in targets `scheduledFor` is null; the card hero clock
    // shows the arrival time instead. Resolve the anchor once so the
    // contract stays `scheduledFor: string` on the wire.
    const hero = target.scheduledFor ?? target.arrivedAt;
    if (!hero) return null;
    return {
      appointmentId: target.id,
      patientId: patient.id,
      patient: {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: serializeDob(patient.dateOfBirth),
        sex: patient.sex ?? null,
      },
      scheduledFor: hero,
      isWalkIn: target.isWalkIn,
      durationMinutes: target.durationMinutes,
      visitCount,
      lastVisitDate: lastVisitDateIso,
      daysSinceLastVisit,
      lastDiagnosis,
      lastWeightG: lastVisit?.weightG ?? null,
      hasAllergyNote:
        typeof patient.alergjiTjera === 'string' &&
        patient.alergjiTjera.trim().length > 0,
    };
  }
}

// ===========================================================================
// Local helpers
// ===========================================================================

function serializeDob(dob: Date | string | null): string | null {
  if (!dob) return null;
  const d = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  if (iso === UNKNOWN_DOB_ISO) return null;
  return iso;
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) return null;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const [yf, mf, df] = fromIso.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const [yt, mt, dt] = toIso.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const a = Date.UTC(yf, mf - 1, df);
  const b = Date.UTC(yt, mt - 1, dt);
  return Math.round((b - a) / 86_400_000);
}

// Re-export PaymentCodes type for the controller to hint against.
export type { PaymentCodes };
