import { ForbiddenException, Injectable } from '@nestjs/common';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { localDateToday, utcMidnight } from '../../common/datetime';
import { isReceptionistOnly } from '../../common/request-context/role-helpers';
import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import { utcToLocalParts } from './visits-calendar.tz';
import {
  type DailySummaryResponse,
  type DailySummaryVisitDto,
  type PaymentCodeBreakdownEntry,
  type PaymentCodeCatalogueEntry,
  PAID_CODES,
  type StatusBreakdown,
} from './visits-daily-summary.dto';
import { VISIT_STATUSES, type VisitStatus } from './visits-calendar.dto';

const VALID_PAYMENT_CODES = ['A', 'B', 'C', 'D', 'E'] as const;
type PaymentCode = (typeof VALID_PAYMENT_CODES)[number];

const RECEPTIONIST_DATE_OUT_OF_RANGE = 'Nuk keni qasje për këtë datë.';

/**
 * Daily Raporti service — aggregates one local day's visits into the
 * shape `/raporti` (on screen) and `/raporti/print` both render.
 *
 * Role surface (ADR-019):
 *  - `doctor` / `clinic_admin` : any date, forward or back.
 *  - `receptionist` (only)     : today and yesterday in Europe/Belgrade
 *                                only. Any other date → 403 Forbidden
 *                                with `reason: 'date_out_of_range'`.
 *
 * Every successful read writes an audit row with action
 * `report.daily.read` and `changes: null`. The resource id is the
 * `YYYY-MM-DD` so analytics can filter by date easily.
 */
@Injectable()
export class VisitsDailySummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async summary(
    clinicId: string,
    date: string,
    ctx: RequestContext,
  ): Promise<DailySummaryResponse> {
    this.assertReceptionistDateRange(date, ctx);

    const [rows, paymentCodes] = await Promise.all([
      this.prisma.visit.findMany({
        where: {
          clinicId,
          deletedAt: null,
          visitDate: utcMidnight(date),
        },
        orderBy: [{ scheduledFor: 'asc' }, { arrivedAt: 'asc' }, { createdAt: 'asc' }],
        include: {
          patient: {
            select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
          },
        },
      }),
      this.clinicPaymentCodes(clinicId),
    ]);

    const patientIds = unique(rows.map((r) => r.patientId));
    const firstVisitMap = await this.fetchFirstVisitDateMap(clinicId, patientIds);

    const visits: DailySummaryVisitDto[] = rows.map((row) =>
      toVisitDto(row, paymentCodes, firstVisitMap, date),
    );

    const agg = aggregate(visits, paymentCodes);

    const response: DailySummaryResponse = {
      date,
      totalRevenueCents: agg.totalRevenueCents,
      visitCount: visits.length,
      statusBreakdown: agg.statusBreakdown,
      paidCount: agg.paidCount,
      paymentCodeBreakdown: agg.paymentCodeBreakdown,
      paymentCodes: paymentCodeCatalogue(paymentCodes),
      visits,
    };

    await this.audit.record({
      ctx,
      action: 'report.daily.read',
      resourceType: 'report',
      resourceId: date,
      changes: null,
    });

    return response;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private assertReceptionistDateRange(date: string, ctx: RequestContext): void {
    if (!isReceptionistOnly(ctx.roles)) return;
    const today = localDateToday();
    if (!isWithinReceptionistRange(date, today)) {
      throw new ForbiddenException({
        message: RECEPTIONIST_DATE_OUT_OF_RANGE,
        reason: 'date_out_of_range',
      });
    }
  }

  private async clinicPaymentCodes(
    clinicId: string,
  ): Promise<Record<string, { label: string; amountCents: number }>> {
    const clinic = await this.prisma.clinic.findFirst({
      where: { id: clinicId, deletedAt: null },
      select: { paymentCodes: true },
    });
    return parsePaymentCodes(clinic?.paymentCodes);
  }

  private async fetchFirstVisitDateMap(
    clinicId: string,
    patientIds: string[],
  ): Promise<Map<string, string>> {
    if (patientIds.length === 0) return new Map();
    const rows = await this.prisma.visit.groupBy({
      by: ['patientId'],
      where: {
        clinicId,
        deletedAt: null,
        patientId: { in: patientIds },
      },
      _min: { visitDate: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      const v = r._min.visitDate;
      if (!v) continue;
      // Prisma types this as Date for `@db.Date` columns; the runtime
      // string branch is defensive only.
      const iso =
        v instanceof Date
          ? v.toISOString().slice(0, 10)
          : String(v).slice(0, 10);
      map.set(r.patientId, iso);
    }
    return map;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers — exported for tests
// ---------------------------------------------------------------------------

export function isWithinReceptionistRange(date: string, today: string): boolean {
  const yesterday = previousDay(today);
  return date === today || date === yesterday;
}

export function previousDay(iso: string): string {
  // Both `iso` and the result are local-day strings — no UTC drift
  // because we step in UTC days and the input is already local-clean
  // (the caller passed `localDateToday()`).
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function parsePaymentCodes(
  raw: unknown,
): Record<string, { label: string; amountCents: number }> {
  if (raw == null || typeof raw !== 'object') return {};
  const out: Record<string, { label: string; amountCents: number }> = {};
  for (const [code, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (entry == null || typeof entry !== 'object') continue;
    const obj = entry as { label?: unknown; amountCents?: unknown };
    const label = typeof obj.label === 'string' ? obj.label : '';
    const amountCents = typeof obj.amountCents === 'number' ? obj.amountCents : 0;
    out[code] = { label, amountCents };
  }
  return out;
}

export function paymentCodeCatalogue(
  codes: Record<string, { label: string; amountCents: number }>,
): PaymentCodeCatalogueEntry[] {
  // Order A → E (canonical print legend order); include codes the
  // clinic has configured in that order, then append anything else
  // alphabetical (defensive — current schema only uses A..E).
  const canonical = ['A', 'B', 'C', 'D', 'E'];
  const out: PaymentCodeCatalogueEntry[] = [];
  for (const code of canonical) {
    if (codes[code]) {
      out.push({ code, label: codes[code].label, amountCents: codes[code].amountCents });
    }
  }
  for (const code of Object.keys(codes).sort()) {
    if (!canonical.includes(code)) {
      out.push({ code, label: codes[code].label, amountCents: codes[code].amountCents });
    }
  }
  return out;
}

interface AggregateResult {
  totalRevenueCents: number;
  statusBreakdown: StatusBreakdown;
  paidCount: number;
  paymentCodeBreakdown: PaymentCodeBreakdownEntry[];
}

export function aggregate(
  visits: DailySummaryVisitDto[],
  codes: Record<string, { label: string; amountCents: number }>,
): AggregateResult {
  const statusBreakdown: StatusBreakdown = {
    scheduled: 0,
    arrived: 0,
    in_progress: 0,
    completed: 0,
    no_show: 0,
  };
  const codeCounts: Record<string, number> = {};
  let totalRevenueCents = 0;
  let paidCount = 0;

  for (const v of visits) {
    statusBreakdown[v.status] += 1;
    if (
      v.status === 'completed' &&
      v.paymentCode &&
      (PAID_CODES as readonly string[]).includes(v.paymentCode)
    ) {
      paidCount += 1;
    }
    if (v.status === 'completed' && v.paymentCode) {
      codeCounts[v.paymentCode] = (codeCounts[v.paymentCode] ?? 0) + 1;
      if (v.paymentAmountCents != null) {
        totalRevenueCents += v.paymentAmountCents;
      }
    }
  }

  const ordered = paymentCodeCatalogue(codes);
  const paymentCodeBreakdown: PaymentCodeBreakdownEntry[] = ordered.map((entry) => ({
    code: entry.code,
    label: entry.label,
    amountCents: entry.amountCents,
    count: codeCounts[entry.code] ?? 0,
    totalCents: (codeCounts[entry.code] ?? 0) * entry.amountCents,
  }));

  return { totalRevenueCents, statusBreakdown, paidCount, paymentCodeBreakdown };
}

// ---------------------------------------------------------------------------
// Row → DTO
// ---------------------------------------------------------------------------

interface RowLike {
  id: string;
  patientId: string;
  scheduledFor: Date | null;
  arrivedAt: Date | null;
  createdAt: Date;
  status: string;
  isWalkIn: boolean;
  paymentCode: string | null;
  visitDate: Date | string;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date | string | null;
  };
}

function toVisitDto(
  row: RowLike,
  codes: Record<string, { label: string; amountCents: number }>,
  firstVisitMap: Map<string, string>,
  reportDate: string,
): DailySummaryVisitDto {
  const status = narrowStatus(row.status);
  const paymentCode = narrowPaymentCode(row.paymentCode);
  const amountCents =
    status === 'completed' && paymentCode && codes[paymentCode]
      ? codes[paymentCode].amountCents
      : null;
  const time = resolveLocalTime(row);
  const firstVisitDate = firstVisitMap.get(row.patientId);
  return {
    id: row.id,
    time,
    patient: {
      id: row.patient.id,
      firstName: row.patient.firstName,
      lastName: row.patient.lastName,
      dateOfBirth: serializeDob(row.patient.dateOfBirth),
    },
    status,
    isWalkIn: row.isWalkIn,
    paymentCode,
    paymentAmountCents: amountCents,
    isFirstVisit: firstVisitDate === reportDate,
  };
}

function resolveLocalTime(row: RowLike): string {
  // Anchor preference: scheduled_for > arrived_at > created_at. The
  // first two are Timestamptz, the third always exists. utcToLocalParts
  // gives us HH:mm in Europe/Belgrade for free, DST-correct.
  const anchor = row.scheduledFor ?? row.arrivedAt ?? row.createdAt;
  return utcToLocalParts(anchor).time;
}

function narrowStatus(value: string): VisitStatus {
  if ((VISIT_STATUSES as readonly string[]).includes(value)) {
    return value as VisitStatus;
  }
  return 'scheduled';
}

function narrowPaymentCode(value: string | null): PaymentCode | null {
  if (!value) return null;
  if ((VALID_PAYMENT_CODES as readonly string[]).includes(value)) {
    return value as PaymentCode;
  }
  return null;
}

function serializeDob(dob: Date | string | null): string | null {
  if (!dob) return null;
  const d = typeof dob === 'string' ? new Date(dob) : dob;
  if (Number.isNaN(d.getTime())) return null;
  const iso = d.toISOString().slice(0, 10);
  // The orphan sentinel (1900-01-01) is treated as "no DOB on file"
  // — see ADR-015.
  if (iso === '1900-01-01') return null;
  return iso;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
