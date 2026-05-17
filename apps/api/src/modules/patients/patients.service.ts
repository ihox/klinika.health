import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditLogService, type AuditFieldDiff } from '../../common/audit/audit-log.service';
import type { RequestContext } from '../../common/request-context/request-context';
import { hasClinicalAccess, isReceptionistOnly } from '../../common/request-context/role-helpers';
import { PrismaService } from '../../prisma/prisma.service';
import {
  type DoctorCreatePatientInput,
  type DoctorUpdatePatientInput,
  type PatientFullDto,
  type PatientPublicDto,
  type PatientSearchQuery,
  type ReceptionistCreatePatientInput,
  toFullDto,
  toPublicDto,
} from './patients.dto';

// Search defaults — the receptionist's quick-search list is capped at
// 10 results (per CLAUDE.md slice-07 §2) but the API permits up to 20
// for the doctor's broader patient browser.
const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 20;

// Trigram similarity threshold for fuzzy matches. 0.30 catches "Hoxa"
// → "Hoxha" while not flooding with one-letter overlaps. The numeric
// score is also used to rank results.
const TRGM_SIMILARITY_THRESHOLD = 0.3;

// Soft-duplicate threshold (looser than search — the receptionist sees
// it during quick-add to surface "is this maybe an existing patient?").
const DUPLICATE_NAME_SIMILARITY = 0.55;
const DUPLICATE_DOB_DAY_WINDOW = 14;

interface SearchRow {
  id: string;
  first_name: string;
  last_name: string;
  date_of_birth: Date | string | null;
  place_of_birth: string | null;
  legacy_id: number | null;
  score: number;
}

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------
  //
  // Single SQL query with layered match strategies. For each row the
  // name-component score is the FIRST matching tier (CASE short-circuits):
  //
  //   1. ILIKE prefix on first_name      → 1.0   ("Rit" → "Rita …")
  //   2. ILIKE prefix on last_name       → 0.9   ("Hox" → "… Hoxha")
  //   3. ILIKE substring on combined     → 0.7   ("ita Hox" → "Rita Hoxha")
  //   4. Trigram fuzzy on combined       → similarity()  ("Hoxa" → "Hoxha")
  //
  // Prefix/substring tiers exist because trigram alone misses short
  // queries: "Rit" against "Rita Hoxha" scores below pg_trgm's 0.3
  // session threshold and the `%` operator returns false. Trigram
  // stays as the last-resort fuzzy fallback for typos. All tiers use
  // `klinika_unaccent_lower` so diacritics ("Çekaj" ↔ "Cekaj") match.
  //
  // Additive boosts on top of the name score:
  //   + full DOB exact match     → +1.5   ("12.02.2024", "Hoxha 12-02-2024")
  //   + legacy_id exact match    → +1.0   ("#4829")
  //   + day+month+year-prefix    → +0.7   ("12.02.2", "12.02.20", "Hoxha 12.02.202")
  //   + day+month any year       → +0.6   ("12.02", "Hoxha 12-02")
  //   + year-of-birth match      → +0.4   ("Hoxha 2024")
  //
  // The DOB tiers form a progressive ladder as the user types out a
  // birthday: each additional digit narrows the cohort and scores a
  // little higher. All boost predicates are also OR'd into the WHERE
  // clause so a pure DOB, year, or legacy_id query (no name token)
  // still returns rows.
  //
  // The query results are converted to either `PatientPublicDto` (for
  // receptionists) or `PatientFullDto` (for doctors / clinic admins).
  // The conversion is per-row at the service layer; even if a future
  // bug surfaces unrelated columns in the SELECT, the DTO chokepoint
  // keeps them out of the wire response.

  async search(
    clinicId: string,
    query: PatientSearchQuery,
    ctx: RequestContext,
  ): Promise<{ patients: Array<PatientPublicDto | PatientFullDto> }> {
    const rawTerm = query.q?.trim() ?? '';
    const limit = Math.min(query.limit ?? SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX);
    // Receptionist privacy boundary: anyone with doctor OR
    // clinic_admin sees full records, even if they also hold the
    // receptionist role. Only the "receptionist-only" caller gets
    // PatientPublicDto.
    const redact = isReceptionistOnly(ctx.roles);

    const rows = await this.runSearch(clinicId, rawTerm, limit, redact);
    // Attach the most-recent-completed-visit date so search results
    // can render the recency dot the receptionist already sees on
    // calendar cards. Cheap groupBy query, runs once per search.
    const lastVisitMap = await this.fetchLastVisitMap(
      clinicId,
      rows.map((r) => (typeof r.id === 'string' ? r.id : String(r.id))),
    );
    const enriched = rows.map((r) => {
      const id = typeof r.id === 'string' ? r.id : String(r.id);
      return { ...r, lastVisitAt: lastVisitMap.get(id) ?? null };
    });
    if (redact) {
      return { patients: enriched.map(rowToPublicDto) };
    }
    return { patients: enriched.map(rowToFullDto) };
  }

  /**
   * For each patient id, return the date of their most recent
   * COMPLETED visit in this clinic. Used by the patient search to
   * power the receptionist's recency dot. Soft-deleted visits are
   * filtered; non-completed statuses don't count (a no-show booking
   * isn't a "visit" from the recency perspective).
   */
  private async fetchLastVisitMap(
    clinicId: string,
    patientIds: string[],
  ): Promise<Map<string, Date>> {
    if (patientIds.length === 0) return new Map();
    const unique = Array.from(new Set(patientIds));
    const rows = await this.prisma.visit.groupBy({
      by: ['patientId'],
      where: {
        clinicId,
        patientId: { in: unique },
        deletedAt: null,
        status: 'completed',
      },
      _max: { visitDate: true },
    });
    const map = new Map<string, Date>();
    for (const r of rows) {
      if (r._max.visitDate) {
        const d =
          typeof r._max.visitDate === 'string'
            ? new Date(r._max.visitDate)
            : r._max.visitDate;
        map.set(r.patientId, d);
      }
    }
    return map;
  }

  private async runSearch(
    clinicId: string,
    term: string,
    limit: number,
    redact: boolean,
  ): Promise<Array<SearchRow & Record<string, unknown>>> {
    if (term.length === 0) {
      // Empty search: return most-recently-created patients so the
      // receptionist's autocomplete isn't blank on focus.
      const rows = await this.prisma.patient.findMany({
        where: { clinicId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: this.selectForRedaction(redact),
      });
      return rows.map((r) => normaliseRow(r));
    }

    const { nameTokens, year, legacyId, dobFull, dobDayMonth, dobDayMonthYearPrefix } =
      parseSearchTerm(term);

    // Raw $queryRaw because Prisma can't express the trigram `%`
    // operator. RLS is enforced by `clinic_id = $1` and by Postgres'
    // policy on the table — defense in depth.
    const nameTerm = nameTokens.join(' ').toLowerCase();
    const hasName = nameTerm.length > 0;
    // Prisma can't bind objects, so each partial-DOB component travels
    // as its own parameter. Null-on-absent so the CASE/WHERE guards
    // short-circuit when the user didn't supply that tier.
    const dobDayMonthDay = dobDayMonth?.day ?? null;
    const dobDayMonthMonth = dobDayMonth?.month ?? null;
    const dobPfxDay = dobDayMonthYearPrefix?.day ?? null;
    const dobPfxMonth = dobDayMonthYearPrefix?.month ?? null;
    const dobPfxYearPrefix = dobDayMonthYearPrefix?.yearPrefix ?? null;

    const result = await this.prisma.$queryRaw<SearchRow[]>`
      SELECT
        p.id::text         AS id,
        p.first_name       AS first_name,
        p.last_name        AS last_name,
        p.date_of_birth    AS date_of_birth,
        p.place_of_birth   AS place_of_birth,
        p.legacy_id        AS legacy_id,
        (
          CASE WHEN ${hasName}::boolean THEN
            CASE
              WHEN klinika_unaccent_lower(p.first_name)
                   LIKE klinika_unaccent_lower(${nameTerm}) || '%' THEN 1.0
              WHEN klinika_unaccent_lower(p.last_name)
                   LIKE klinika_unaccent_lower(${nameTerm}) || '%' THEN 0.9
              WHEN klinika_unaccent_lower(p.first_name || ' ' || p.last_name)
                   LIKE '%' || klinika_unaccent_lower(${nameTerm}) || '%' THEN 0.7
              WHEN klinika_unaccent_lower(p.first_name || ' ' || p.last_name)
                   % klinika_unaccent_lower(${nameTerm}) THEN
                similarity(
                  klinika_unaccent_lower(p.first_name || ' ' || p.last_name),
                  klinika_unaccent_lower(${nameTerm})
                )
              ELSE 0
            END
          ELSE 0 END
        ) + (
          CASE WHEN ${dobFull}::date IS NOT NULL AND p.date_of_birth = ${dobFull}::date THEN 1.5 ELSE 0 END
        ) + (
          CASE WHEN ${legacyId}::int IS NOT NULL AND p.legacy_id = ${legacyId}::int THEN 1.0 ELSE 0 END
        ) + (
          CASE WHEN ${dobPfxDay}::int IS NOT NULL
                AND EXTRACT(DAY FROM p.date_of_birth)::int = ${dobPfxDay}::int
                AND EXTRACT(MONTH FROM p.date_of_birth)::int = ${dobPfxMonth}::int
                AND EXTRACT(YEAR FROM p.date_of_birth)::text LIKE ${dobPfxYearPrefix} || '%'
               THEN 0.7 ELSE 0 END
        ) + (
          CASE WHEN ${dobDayMonthDay}::int IS NOT NULL
                AND EXTRACT(DAY FROM p.date_of_birth)::int = ${dobDayMonthDay}::int
                AND EXTRACT(MONTH FROM p.date_of_birth)::int = ${dobDayMonthMonth}::int
               THEN 0.6 ELSE 0 END
        ) + (
          CASE WHEN ${year}::int IS NOT NULL AND EXTRACT(YEAR FROM p.date_of_birth)::int = ${year}::int THEN 0.4 ELSE 0 END
        ) AS score
      FROM patients p
      WHERE p.clinic_id = ${clinicId}::uuid
        AND p.deleted_at IS NULL
        AND (
          (${hasName}::boolean AND (
            klinika_unaccent_lower(p.first_name)
              LIKE klinika_unaccent_lower(${nameTerm}) || '%'
            OR klinika_unaccent_lower(p.last_name)
              LIKE klinika_unaccent_lower(${nameTerm}) || '%'
            OR klinika_unaccent_lower(p.first_name || ' ' || p.last_name)
              LIKE '%' || klinika_unaccent_lower(${nameTerm}) || '%'
            OR klinika_unaccent_lower(p.first_name || ' ' || p.last_name)
              % klinika_unaccent_lower(${nameTerm})
          ))
          OR (${dobFull}::date IS NOT NULL AND p.date_of_birth = ${dobFull}::date)
          OR (${legacyId}::int IS NOT NULL AND p.legacy_id = ${legacyId}::int)
          OR (${dobPfxDay}::int IS NOT NULL
              AND EXTRACT(DAY FROM p.date_of_birth)::int = ${dobPfxDay}::int
              AND EXTRACT(MONTH FROM p.date_of_birth)::int = ${dobPfxMonth}::int
              AND EXTRACT(YEAR FROM p.date_of_birth)::text LIKE ${dobPfxYearPrefix} || '%')
          OR (${dobDayMonthDay}::int IS NOT NULL
              AND EXTRACT(DAY FROM p.date_of_birth)::int = ${dobDayMonthDay}::int
              AND EXTRACT(MONTH FROM p.date_of_birth)::int = ${dobDayMonthMonth}::int)
          OR (${year}::int IS NOT NULL AND EXTRACT(YEAR FROM p.date_of_birth)::int = ${year}::int)
        )
      ORDER BY score DESC, p.last_name ASC, p.first_name ASC
      LIMIT ${limit}::int
    `;

    if (result.length === 0) {
      return [];
    }

    // Re-hydrate full columns by id for the doctor path (the raw query
    // only returned the lean SELECT). Redacted (receptionist-only)
    // path doesn't need anything more — toPublicDto only reads the
    // four fields we already have.
    if (redact) {
      return result.map((r) => normaliseRow(r));
    }
    const ids = result.map((r) => r.id);
    const full = await this.prisma.patient.findMany({
      where: { clinicId, id: { in: ids }, deletedAt: null },
      select: this.selectForRedaction(redact),
    });
    const byId = new Map(full.map((r) => [r.id, r]));
    return result
      .map((r) => byId.get(r.id))
      .filter((r): r is NonNullable<typeof r> => r != null)
      .map((r) => normaliseRow(r));
  }

  // -------------------------------------------------------------------------
  // Soft duplicate check (receptionist quick-add)
  // -------------------------------------------------------------------------
  //
  // Informational only — per the locked design decision, this NEVER
  // blocks creation. The receptionist sees the notice and either picks
  // an existing patient or continues with a new one.

  async findLikelyDuplicates(
    clinicId: string,
    firstName: string,
    lastName: string,
    dateOfBirth: string | null,
  ): Promise<PatientPublicDto[]> {
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    if (trimmedFirst.length === 0 && trimmedLast.length === 0) {
      return [];
    }
    const combined = `${trimmedFirst} ${trimmedLast}`.trim().toLowerCase();
    const dobIso = dateOfBirth ?? null;

    const rows = await this.prisma.$queryRaw<SearchRow[]>`
      SELECT
        p.id::text          AS id,
        p.first_name        AS first_name,
        p.last_name         AS last_name,
        p.date_of_birth     AS date_of_birth,
        p.place_of_birth    AS place_of_birth,
        p.legacy_id         AS legacy_id,
        similarity(
          klinika_unaccent_lower(p.first_name || ' ' || p.last_name),
          klinika_unaccent_lower(${combined})
        ) AS score
      FROM patients p
      WHERE p.clinic_id = ${clinicId}::uuid
        AND p.deleted_at IS NULL
        AND klinika_unaccent_lower(p.first_name || ' ' || p.last_name) % klinika_unaccent_lower(${combined})
        AND similarity(
          klinika_unaccent_lower(p.first_name || ' ' || p.last_name),
          klinika_unaccent_lower(${combined})
        ) >= ${DUPLICATE_NAME_SIMILARITY}::float
        AND (
          ${dobIso}::date IS NULL
          OR p.date_of_birth IS NULL
          OR ABS(p.date_of_birth - ${dobIso}::date) <= ${DUPLICATE_DOB_DAY_WINDOW}::int
        )
      ORDER BY score DESC, p.last_name ASC
      LIMIT 5
    `;

    return rows.map((r) => toPublicDto({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      dateOfBirth: r.date_of_birth,
      placeOfBirth: r.place_of_birth,
    }));
  }

  // -------------------------------------------------------------------------
  // Get one (DOCTOR ONLY)
  // -------------------------------------------------------------------------

  async getById(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<PatientFullDto> {
    this.requireDoctorOrAdmin(ctx);
    const row = await this.prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Pacienti nuk u gjet.');
    await this.audit.record({
      ctx,
      action: 'patient.viewed',
      resourceType: 'patient',
      resourceId: id,
      // Sensitive read: changes are null (per CLAUDE.md §5.3).
      changes: null,
    });
    return toFullDto(row);
  }

  // -------------------------------------------------------------------------
  // Create — receptionist (minimal) and doctor (full)
  // -------------------------------------------------------------------------

  async createMinimal(
    clinicId: string,
    payload: ReceptionistCreatePatientInput,
    ctx: RequestContext,
  ): Promise<PatientPublicDto> {
    // Strict DTO already stripped any unknown keys; here we just
    // commit the three permitted columns. `lastName` may be an empty
    // string when the receptionist captures only the first name — the
    // column is NOT NULL but stores '', and the doctor's
    // isPatientComplete predicate treats '' as missing so the patient
    // is routed to the master-data form on the doctor's next click.
    const created = await this.prisma.patient.create({
      data: {
        clinicId,
        firstName: payload.firstName,
        lastName: payload.lastName ?? '',
        // dateOfBirth is required at the schema level (column is NOT
        // NULL). When the receptionist doesn't capture it, the doctor
        // fills it on the first visit; until then we store a sentinel
        // far in the past so soft-delete + RLS still work. UI hides
        // dateOfBirth when it equals the sentinel.
        dateOfBirth: payload.dateOfBirth ?? UNKNOWN_DOB_SENTINEL,
      },
    });
    await this.audit.record({
      ctx,
      action: 'patient.created',
      resourceType: 'patient',
      resourceId: created.id,
      changes: [
        { field: 'firstName', old: null, new: created.firstName },
        { field: 'lastName', old: null, new: created.lastName || null },
        {
          field: 'dateOfBirth',
          old: null,
          new: payload.dateOfBirth ?? null,
        },
        { field: 'source', old: null, new: 'receptionist_quick_add' },
      ],
    });
    return toPublicDto({
      id: created.id,
      firstName: created.firstName,
      lastName: created.lastName,
      dateOfBirth: payload.dateOfBirth ?? null,
    });
  }

  async createFull(
    clinicId: string,
    payload: DoctorCreatePatientInput,
    ctx: RequestContext,
  ): Promise<PatientFullDto> {
    this.requireDoctorOrAdmin(ctx);
    const created = await this.prisma.patient.create({
      data: {
        clinicId,
        firstName: payload.firstName,
        lastName: payload.lastName,
        // Prisma 5 rejects bare date strings for `@db.Date` columns
        // ("Expected ISO-8601 DateTime"); wrap to a UTC-midnight Date
        // — same construction the `update` method below uses.
        dateOfBirth: new Date(payload.dateOfBirth),
        sex: payload.sex,
        placeOfBirth: payload.placeOfBirth ?? null,
        phone: payload.phone ?? null,
        birthWeightG: payload.birthWeightG ?? null,
        birthLengthCm:
          payload.birthLengthCm != null
            ? new Prisma.Decimal(payload.birthLengthCm)
            : null,
        birthHeadCircumferenceCm:
          payload.birthHeadCircumferenceCm != null
            ? new Prisma.Decimal(payload.birthHeadCircumferenceCm)
            : null,
        alergjiTjera: payload.alergjiTjera ?? null,
      },
    });
    await this.audit.record({
      ctx,
      action: 'patient.created',
      resourceType: 'patient',
      resourceId: created.id,
      changes: [
        { field: 'firstName', old: null, new: created.firstName },
        { field: 'lastName', old: null, new: created.lastName },
        { field: 'dateOfBirth', old: null, new: payload.dateOfBirth },
        { field: 'source', old: null, new: 'doctor_full_form' },
      ],
    });
    return toFullDto(created);
  }

  // -------------------------------------------------------------------------
  // Update — doctor only
  // -------------------------------------------------------------------------

  async update(
    clinicId: string,
    id: string,
    payload: DoctorUpdatePatientInput,
    ctx: RequestContext,
  ): Promise<PatientFullDto> {
    this.requireDoctorOrAdmin(ctx);
    const before = await this.prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Pacienti nuk u gjet.');

    const data: Prisma.PatientUpdateInput = {};
    if (payload.firstName !== undefined) data.firstName = payload.firstName;
    if (payload.lastName !== undefined) data.lastName = payload.lastName;
    if (payload.dateOfBirth !== undefined) data.dateOfBirth = new Date(payload.dateOfBirth);
    if (payload.sex !== undefined) data.sex = payload.sex;
    if (payload.placeOfBirth !== undefined) data.placeOfBirth = payload.placeOfBirth ?? null;
    if (payload.phone !== undefined) data.phone = payload.phone ?? null;
    if (payload.birthWeightG !== undefined) data.birthWeightG = payload.birthWeightG ?? null;
    if (payload.birthLengthCm !== undefined) {
      data.birthLengthCm =
        payload.birthLengthCm != null ? new Prisma.Decimal(payload.birthLengthCm) : null;
    }
    if (payload.birthHeadCircumferenceCm !== undefined) {
      data.birthHeadCircumferenceCm =
        payload.birthHeadCircumferenceCm != null
          ? new Prisma.Decimal(payload.birthHeadCircumferenceCm)
          : null;
    }
    if (payload.alergjiTjera !== undefined) data.alergjiTjera = payload.alergjiTjera ?? null;

    if (Object.keys(data).length === 0) {
      return toFullDto(before);
    }

    const after = await this.prisma.patient.update({
      where: { id },
      data,
    });

    const diffs = computeDiffs(before, after);
    if (diffs.length > 0) {
      await this.audit.record({
        ctx,
        action: 'patient.updated',
        resourceType: 'patient',
        resourceId: id,
        changes: diffs,
      });
    }
    return toFullDto(after);
  }

  // -------------------------------------------------------------------------
  // Soft delete (doctor only)
  // -------------------------------------------------------------------------

  async softDelete(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<{ status: 'ok'; restorableUntil: string }> {
    this.requireDoctorOrAdmin(ctx);
    const before = await this.prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Pacienti nuk u gjet.');
    const now = new Date();
    await this.prisma.patient.update({
      where: { id },
      data: { deletedAt: now },
    });
    await this.audit.record({
      ctx,
      action: 'patient.deleted',
      resourceType: 'patient',
      resourceId: id,
      changes: [{ field: 'deletedAt', old: null, new: now.toISOString() }],
    });
    // 30-second undo window per CLAUDE.md §5.5. The wire response carries
    // the wall-clock deadline; the frontend toast counts down against it.
    return {
      status: 'ok',
      restorableUntil: new Date(now.getTime() + 30_000).toISOString(),
    };
  }

  async restore(
    clinicId: string,
    id: string,
    ctx: RequestContext,
  ): Promise<PatientFullDto> {
    this.requireDoctorOrAdmin(ctx);
    // Soft-delete middleware filters `deleted_at IS NULL` from normal
    // reads — use the raw client for this lookup.
    const row = await this.prisma.patient.findFirst({
      where: { id, clinicId, deletedAt: { not: null } },
    });
    if (!row) throw new NotFoundException('Pacienti nuk u gjet ose nuk është i fshirë.');
    const restored = await this.prisma.patient.update({
      where: { id },
      data: { deletedAt: null },
    });
    await this.audit.record({
      ctx,
      action: 'patient.restored',
      resourceType: 'patient',
      resourceId: id,
      changes: [{ field: 'deletedAt', old: row.deletedAt?.toISOString() ?? null, new: null }],
    });
    return toFullDto(restored);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private requireDoctorOrAdmin(ctx: RequestContext): void {
    if (hasClinicalAccess(ctx.roles)) return;
    throw new ForbiddenException('Vetëm mjeku ka qasje në këtë veprim.');
  }

  private selectForRedaction(redact: boolean): Prisma.PatientSelect {
    // The query never returns more than the redaction allows, even
    // though the DTO chokepoint is the actual gate. Defense in depth:
    // if a future maintainer skips `toPublicDto`, the underlying row
    // still doesn't contain the forbidden columns.
    if (redact) {
      return {
        id: true,
        firstName: true,
        lastName: true,
        dateOfBirth: true,
        placeOfBirth: true,
      };
    }
    return {
      id: true,
      clinicId: true,
      legacyId: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      sex: true,
      placeOfBirth: true,
      phone: true,
      birthWeightG: true,
      birthLengthCm: true,
      birthHeadCircumferenceCm: true,
      alergjiTjera: true,
      createdAt: true,
      updatedAt: true,
    };
  }
}

// ===========================================================================
// Pure helpers
// ===========================================================================

/**
 * Sentinel DOB used when the receptionist quick-adds a patient
 * without capturing a date of birth. The column is NOT NULL because
 * many downstream features (WHO charts, age display) assume a value;
 * the sentinel keeps those features safe while the doctor fills the
 * real date at the first visit. We map this back to `null` at the DTO
 * boundary so the UI sees absence rather than a fake date.
 */
export const UNKNOWN_DOB_SENTINEL = new Date('1900-01-01T00:00:00Z');

export function isUnknownDob(value: Date | string | null | undefined): boolean {
  if (value == null) return true;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return true;
  return d.getTime() === UNKNOWN_DOB_SENTINEL.getTime();
}

function parseSearchTerm(term: string): {
  nameTokens: string[];
  year: number | null;
  legacyId: number | null;
  dobFull: string | null;
  dobDayMonth: { day: number; month: number } | null;
  dobDayMonthYearPrefix: { day: number; month: number; yearPrefix: string } | null;
} {
  const rawTokens = term.split(/\s+/).filter((t) => t.length > 0);
  let year: number | null = null;
  let legacyId: number | null = null;
  let dobFull: string | null = null;
  let dobDayMonth: { day: number; month: number } | null = null;
  let dobDayMonthYearPrefix:
    | { day: number; month: number; yearPrefix: string }
    | null = null;
  const nameTokens: string[] = [];
  for (const raw of rawTokens) {
    // Strip TRAILING separators only — a user mid-typing "12.02." has
    // a full day+month token plus a half-typed third component. Leading
    // separators (".12.02") are intentional typos and stay so the
    // token falls through to nameTokens normally; middle separators
    // are part of the pattern and are preserved.
    const t = raw.replace(/[./-]+$/, '');
    if (t.length === 0) continue;
    // Date-shaped tokens, most specific first. A tier only consumes
    // the token when validation succeeds — if a regex matches the
    // shape but the date is impossible (Feb 30, month 13), the token
    // keeps falling through and eventually lands in nameTokens, which
    // produces an intuitive empty/name-only result rather than a
    // silently-dropped query.
    //
    //   Tier 1 — full DOB:               DD.MM.YYYY  (3rd group 4 digits)
    //   Tier 2 — day+month+year-prefix:  DD.MM.Y..Y  (3rd group 1-3 digits)
    //   Tier 3 — day+month:              DD.MM       (no 3rd group)
    //   Tier 4 — year alone:             YYYY
    //   Tier 5 — legacy_id:              digits, optional #
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{4}$/.test(t)) {
      const iso = tryParseDobToken(t);
      if (iso) {
        dobFull = iso;
        continue;
      }
    }
    if (/^\d{1,2}[./-]\d{1,2}[./-]\d{1,3}$/.test(t)) {
      const pfx = tryParseDobDayMonthYearPrefixToken(t);
      if (pfx) {
        dobDayMonthYearPrefix = pfx;
        continue;
      }
    }
    if (/^\d{1,2}[./-]\d{1,2}$/.test(t)) {
      const dm = tryParseDobDayMonthToken(t);
      if (dm) {
        dobDayMonth = dm;
        continue;
      }
    }
    if (/^\d{4}$/.test(t)) {
      const n = Number(t);
      if (n >= 1900 && n <= 2100) {
        year = n;
        continue;
      }
    }
    if (/^#?\d{1,7}$/.test(t)) {
      const stripped = t.replace(/^#/, '');
      const n = Number(stripped);
      if (Number.isInteger(n)) {
        legacyId = n;
        continue;
      }
    }
    nameTokens.push(t);
  }
  return { nameTokens, year, legacyId, dobFull, dobDayMonth, dobDayMonthYearPrefix };
}

function tryParseDobToken(token: string): string | null {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(token);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (year < 1900 || year > 2100) return null;
  // Round-trip via UTC Date so impossible dates (Feb 30 wraps to Mar 2,
  // April 31 wraps to May 1) get rejected when the components disagree.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  const yyyy = year.toString().padStart(4, '0');
  const mm = month.toString().padStart(2, '0');
  const dd = day.toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Per-month max-day table. Feb is 29 (not 28) on purpose — the partial
// "29.02" pattern has no year context so we can't know whether it's a
// leap year; we accept it and rely on the row-level EXTRACT match to
// surface only actual Feb 29 patients (leap-year births).
const MAX_DAYS_PER_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function tryParseDobDayMonthToken(token: string): { day: number; month: number } | null {
  const m = /^(\d{1,2})[./-](\d{1,2})$/.exec(token);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > MAX_DAYS_PER_MONTH[month - 1]!) return null;
  return { day, month };
}

function tryParseDobDayMonthYearPrefixToken(
  token: string,
): { day: number; month: number; yearPrefix: string } | null {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{1,3})$/.exec(token);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const yearPrefix = m[3]!;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > MAX_DAYS_PER_MONTH[month - 1]!) return null;
  // yearPrefix is 1-3 digits by regex. We don't require it to start
  // with '1' or '2'; an impossible prefix ("0", "5") simply returns
  // zero rows from the SQL LIKE — same UX as any miss.
  return { day, month, yearPrefix };
}

function computeDiffs(before: object, after: object): AuditFieldDiff[] {
  const beforeRec = before as Record<string, unknown>;
  const afterRec = after as Record<string, unknown>;
  const tracked = [
    'firstName',
    'lastName',
    'dateOfBirth',
    'sex',
    'placeOfBirth',
    'phone',
    'birthWeightG',
    'birthLengthCm',
    'birthHeadCircumferenceCm',
    'alergjiTjera',
  ] as const;
  const diffs: AuditFieldDiff[] = [];
  for (const key of tracked) {
    const oldVal = normaliseForDiff(beforeRec[key]);
    const newVal = normaliseForDiff(afterRec[key]);
    if (oldVal !== newVal) {
      diffs.push({ field: key, old: oldVal, new: newVal });
    }
  }
  return diffs;
}

function normaliseForDiff(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object' && 'toString' in value) {
    // Prisma Decimal — stringify for stable comparison.
    return value.toString();
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return JSON.stringify(value);
}

function rowToPublicDto(row: SearchRow & Record<string, unknown>): PatientPublicDto {
  return toPublicDto({
    id: typeof row.id === 'string' ? row.id : String(row.id),
    firstName: (row.firstName as string | undefined) ?? (row.first_name as string),
    lastName: (row.lastName as string | undefined) ?? (row.last_name as string),
    dateOfBirth:
      (row.dateOfBirth as Date | string | null | undefined) ??
      (row.date_of_birth as Date | string | null | undefined) ??
      null,
    placeOfBirth:
      (row.placeOfBirth as string | null | undefined) ??
      (row.place_of_birth as string | null | undefined) ??
      null,
    lastVisitAt:
      (row.lastVisitAt as Date | string | null | undefined) ??
      (row.last_visit_at as Date | string | null | undefined) ??
      null,
  });
}

function rowToFullDto(row: SearchRow & Record<string, unknown>): PatientFullDto {
  // The raw search rows come back with snake_case keys; full rows
  // hydrated via `findMany` come back camelCase. Normalise both.
  const merged = {
    id: typeof row.id === 'string' ? row.id : String(row.id),
    clinicId: (row.clinicId as string | undefined) ?? (row.clinic_id as string),
    legacyId: (row.legacyId as number | null | undefined) ?? (row.legacy_id as number | null),
    firstName: (row.firstName as string | undefined) ?? (row.first_name as string),
    lastName: (row.lastName as string | undefined) ?? (row.last_name as string),
    dateOfBirth:
      (row.dateOfBirth as Date | string | null | undefined) ??
      (row.date_of_birth as Date | string | null | undefined) ??
      null,
    sex: ((row.sex as 'm' | 'f' | null | undefined) ?? null) || null,
    placeOfBirth: (row.placeOfBirth as string | null | undefined) ?? null,
    phone: (row.phone as string | null | undefined) ?? null,
    birthWeightG:
      (row.birthWeightG as number | null | undefined) ??
      (row.birth_weight_g as number | null | undefined) ??
      null,
    birthLengthCm:
      (row.birthLengthCm as number | string | null | undefined) ??
      (row.birth_length_cm as number | string | null | undefined) ??
      null,
    birthHeadCircumferenceCm:
      (row.birthHeadCircumferenceCm as number | string | null | undefined) ??
      (row.birth_head_circumference_cm as number | string | null | undefined) ??
      null,
    alergjiTjera: (row.alergjiTjera as string | null | undefined) ?? null,
    lastVisitAt:
      (row.lastVisitAt as Date | string | null | undefined) ??
      (row.last_visit_at as Date | string | null | undefined) ??
      null,
    createdAt:
      (row.createdAt as Date | string | undefined) ??
      (row.created_at as Date | string | undefined) ??
      new Date(),
    updatedAt:
      (row.updatedAt as Date | string | undefined) ??
      (row.updated_at as Date | string | undefined) ??
      new Date(),
  };
  return toFullDto(merged);
}

function normaliseRow(row: object): SearchRow & Record<string, unknown> {
  // The lazy union of Prisma findMany rows and raw $queryRaw rows.
  // Tests assume both shapes flow through the same `rowTo*Dto` helpers
  // unchanged.
  return row as SearchRow & Record<string, unknown>;
}

// Re-export for unit tests.
export { parseSearchTerm, TRGM_SIMILARITY_THRESHOLD };
