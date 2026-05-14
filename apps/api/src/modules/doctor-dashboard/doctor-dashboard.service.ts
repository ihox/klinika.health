import { Injectable } from '@nestjs/common';

import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import {
  localClockToUtc,
  utcToLocalParts,
} from '../appointments/appointments.tz';
import { parsePaymentCodesOrDefault } from '../clinic-settings/clinic-settings.service';
import type { PaymentCodes } from '../clinic-settings/clinic-settings.dto';
import {
  type DashboardAppointmentDto,
  type DashboardNextPatientCard,
  type DashboardVisitLogEntry,
  type DoctorDashboardResponse,
} from './doctor-dashboard.dto';
import { computeDayStats } from './doctor-dashboard.stats';

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
    const today = overrideDate ?? utcToLocalParts(now).date;
    const dayStartUtc = localClockToUtc(today, '00:00');
    const dayEndUtc = new Date(dayStartUtc.getTime() + 86_400_000);

    // Pad ±24h so DST-day boundaries don't drop appointments stored
    // close to midnight local; we filter back to the requested local
    // day in JS.
    const dayQueryStart = new Date(dayStartUtc.getTime() - 86_400_000);
    const dayQueryEnd = new Date(dayEndUtc.getTime() + 86_400_000);

    const [clinic, rawAppointments, visits] = await Promise.all([
      this.prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { paymentCodes: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          clinicId,
          deletedAt: null,
          scheduledFor: { gte: dayQueryStart, lte: dayQueryEnd },
        },
        orderBy: { scheduledFor: 'asc' },
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
      this.prisma.visit.findMany({
        where: {
          clinicId,
          deletedAt: null,
          visitDate: { gte: dayStartUtc, lt: dayEndUtc },
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
    ]);

    const paymentCodes = parsePaymentCodesOrDefault(clinic?.paymentCodes);
    const paymentAmount = (code: string): number | null =>
      paymentCodes[code]?.amountCents ?? null;

    const appointments = rawAppointments.filter(
      (a) => utcToLocalParts(a.scheduledFor).date === today,
    );

    const dashboardAppointments = this.classifyAppointments(appointments, now);

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

    return {
      date: today,
      serverTime: now.toISOString(),
      appointments: dashboardAppointments,
      todayVisits,
      nextPatient,
      stats,
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private classifyAppointments(
    appointments: Array<{
      id: string;
      patientId: string;
      scheduledFor: Date;
      durationMinutes: number;
      status: 'scheduled' | 'completed' | 'no_show' | 'cancelled';
      patient: {
        firstName: string;
        lastName: string;
        dateOfBirth: Date | string | null;
      };
    }>,
    now: Date,
  ): DashboardAppointmentDto[] {
    let nextIndex = -1;
    let currentIndex = -1;
    appointments.forEach((a, idx) => {
      if (a.status !== 'scheduled') return;
      const start = a.scheduledFor.getTime();
      const end = start + a.durationMinutes * 60_000;
      const nowMs = now.getTime();
      if (start <= nowMs && nowMs < end && currentIndex === -1) {
        currentIndex = idx;
      }
    });
    if (currentIndex === -1) {
      // No appointment is in-progress; the next is the earliest
      // scheduled one whose start is strictly in the future.
      appointments.forEach((a, idx) => {
        if (a.status !== 'scheduled') return;
        if (a.scheduledFor.getTime() <= now.getTime()) return;
        if (nextIndex === -1) nextIndex = idx;
      });
    }
    return appointments.map((a, idx) => {
      let position: DashboardAppointmentDto['position'];
      if (idx === currentIndex) {
        position = 'current';
      } else if (idx === nextIndex) {
        position = 'next';
      } else if (a.status !== 'scheduled') {
        position = 'past';
      } else if (
        a.scheduledFor.getTime() + a.durationMinutes * 60_000 <
        now.getTime()
      ) {
        position = 'past';
      } else {
        position = 'upcoming';
      }
      return {
        id: a.id,
        patientId: a.patientId,
        patient: {
          firstName: a.patient.firstName,
          lastName: a.patient.lastName,
          dateOfBirth: serializeDob(a.patient.dateOfBirth),
        },
        scheduledFor: a.scheduledFor.toISOString(),
        durationMinutes: a.durationMinutes,
        status: a.status,
        position,
      };
    });
  }

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
      this.prisma.visit.findFirst({
        where: { clinicId, patientId: target.patientId, deletedAt: null },
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
        where: { clinicId, patientId: target.patientId, deletedAt: null },
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
    return {
      appointmentId: target.id,
      patientId: patient.id,
      patient: {
        firstName: patient.firstName,
        lastName: patient.lastName,
        dateOfBirth: serializeDob(patient.dateOfBirth),
        sex: patient.sex ?? null,
      },
      scheduledFor: target.scheduledFor,
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
