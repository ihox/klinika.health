import { ForbiddenException, Injectable } from '@nestjs/common';

import type { RequestContext } from '../../common/request-context/request-context';
import { PrismaService } from '../../prisma/prisma.service';
import type { Icd10ResultDto } from './icd10.dto';

/**
 * Number of frequently-used codes to surface at the top of the
 * dropdown. CLAUDE-described as "top 5"; lifted here so the unit test
 * can assert the boundary.
 */
export const FREQUENT_TOP_N = 5;

@Injectable()
export class Icd10Service {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  //
  // Strategy:
  //   1. Pull the doctor's top-N usage rows for codes matching the query.
  //      These are stamped `frequentlyUsed: true` and pinned to the top.
  //   2. Run a separate query for alphabetical-by-code matches against
  //      the catalogue, applying the same `q` filter. Skip codes that
  //      already appeared in (1).
  //   3. Concatenate, cap at `limit`, return.
  //
  // The query matches:
  //   * code prefix (case-insensitive). Single-letter `q` like "j" or
  //     "J" hits the J-chapter naturally because ICD-10 codes start
  //     with the chapter letter.
  //   * description substring (case-insensitive).
  //   * empty `q` → return the doctor's most-used codes first, then the
  //     `common = true` catalogue rows. This is what the dropdown shows
  //     on first focus before the doctor types anything.

  async search(
    ctx: RequestContext,
    q: string,
    limit: number,
  ): Promise<{ results: Icd10ResultDto[] }> {
    if (ctx.role !== 'doctor' && ctx.role !== 'clinic_admin') {
      throw new ForbiddenException('Vetëm mjeku ka qasje në kërkimin ICD-10.');
    }
    if (!ctx.userId) {
      throw new ForbiddenException('Sesioni i pavlefshëm.');
    }

    const trimmed = q.trim();

    // -------------------------------------------------------------------------
    // 1. Frequently-used boost — top N for this doctor that match `q`.
    // -------------------------------------------------------------------------
    const frequentRows = await this.prisma.doctorDiagnosisUsage.findMany({
      where: {
        doctorId: ctx.userId,
        ...(trimmed.length > 0 ? { code: codeMatchFilter(trimmed) } : {}),
      },
      include: { code: true },
      orderBy: [{ useCount: 'desc' }, { lastUsedAt: 'desc' }],
      take: FREQUENT_TOP_N,
    });

    const frequentCodes = new Set(frequentRows.map((r) => r.icd10Code));

    const frequentResults: Icd10ResultDto[] = frequentRows.map((r) => ({
      code: r.code.code,
      latinDescription: r.code.latinDescription,
      chapter: r.code.chapter,
      useCount: r.useCount,
      frequentlyUsed: true,
    }));

    // -------------------------------------------------------------------------
    // 2. Alphabetical catalogue matches — exclude already-shown frequents.
    // -------------------------------------------------------------------------
    const catalogueLimit = Math.max(0, limit - frequentResults.length);
    let catalogueResults: Icd10ResultDto[] = [];
    if (catalogueLimit > 0) {
      const excludeCodes = Array.from(frequentCodes);
      const baseWhere: Record<string, unknown> =
        trimmed.length > 0
          ? buildSearchWhere(trimmed)
          : { common: true };
      const where: Record<string, unknown> = { ...baseWhere };
      if (excludeCodes.length > 0) {
        where['code'] = { notIn: excludeCodes };
      }
      const rows = await this.prisma.icd10Code.findMany({
        where,
        orderBy: [{ code: 'asc' }],
        take: catalogueLimit,
      });

      // Pull personal counts for the catalogue subset so the UI badge
      // can show "12×" even when the result isn't in the top-N boost.
      const counts = await this.prisma.doctorDiagnosisUsage.findMany({
        where: {
          doctorId: ctx.userId,
          icd10Code: { in: rows.map((r) => r.code) },
        },
        select: { icd10Code: true, useCount: true },
      });
      const countMap = new Map(counts.map((c) => [c.icd10Code, c.useCount]));

      catalogueResults = rows.map((r) => ({
        code: r.code,
        latinDescription: r.latinDescription,
        chapter: r.chapter,
        useCount: countMap.get(r.code) ?? 0,
        frequentlyUsed: false,
      }));
    }

    return {
      results: [...frequentResults, ...catalogueResults].slice(0, limit),
    };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Prisma `where.code` for usage-table joins (the embedded code relation
 * is also an Icd10Code, so the filter shape is identical).
 */
export function codeMatchFilter(q: string): Record<string, unknown> {
  return {
    OR: [
      { code: { startsWith: q, mode: 'insensitive' } },
      { latinDescription: { contains: q, mode: 'insensitive' } },
    ],
  };
}

/**
 * Prisma `where` for the icd10_codes table. Same OR logic as
 * `codeMatchFilter` but at the top level.
 */
export function buildSearchWhere(q: string): {
  OR: Array<Record<string, unknown>>;
  code?: Record<string, unknown>;
} {
  return {
    OR: [
      { code: { startsWith: q, mode: 'insensitive' } },
      { latinDescription: { contains: q, mode: 'insensitive' } },
    ],
  };
}

/**
 * Pure ranking helper — used by the unit test to assert the boost
 * order without standing up Postgres. Mirrors what {@link Icd10Service.search}
 * does in two SQL queries, against in-memory fixtures.
 */
export function rankSearchResults(input: {
  q: string;
  limit: number;
  catalogue: Array<{
    code: string;
    latinDescription: string;
    chapter: string;
    common: boolean;
  }>;
  usage: Array<{ icd10Code: string; useCount: number; lastUsedAt: Date }>;
}): Icd10ResultDto[] {
  const { q, limit, catalogue, usage } = input;
  const lowered = q.trim().toLowerCase();

  const matches = (c: { code: string; latinDescription: string }): boolean => {
    if (lowered.length === 0) return true;
    return (
      c.code.toLowerCase().startsWith(lowered) ||
      c.latinDescription.toLowerCase().includes(lowered)
    );
  };

  const codeIndex = new Map(catalogue.map((c) => [c.code, c]));

  const matchingUsage = usage
    .filter((u) => {
      const c = codeIndex.get(u.icd10Code);
      return c ? matches(c) : false;
    })
    .sort((a, b) => {
      if (b.useCount !== a.useCount) return b.useCount - a.useCount;
      return b.lastUsedAt.getTime() - a.lastUsedAt.getTime();
    })
    .slice(0, FREQUENT_TOP_N);

  const frequentCodes = new Set(matchingUsage.map((u) => u.icd10Code));

  const frequent: Icd10ResultDto[] = matchingUsage.map((u) => {
    const c = codeIndex.get(u.icd10Code)!;
    return {
      code: c.code,
      latinDescription: c.latinDescription,
      chapter: c.chapter,
      useCount: u.useCount,
      frequentlyUsed: true,
    };
  });

  const usageMap = new Map(usage.map((u) => [u.icd10Code, u.useCount]));

  const catalogueMatches = catalogue
    .filter((c) => !frequentCodes.has(c.code))
    .filter((c) => (lowered.length === 0 ? c.common : matches(c)))
    .sort((a, b) => a.code.localeCompare(b.code))
    .slice(0, Math.max(0, limit - frequent.length))
    .map<Icd10ResultDto>((c) => ({
      code: c.code,
      latinDescription: c.latinDescription,
      chapter: c.chapter,
      useCount: usageMap.get(c.code) ?? 0,
      frequentlyUsed: false,
    }));

  return [...frequent, ...catalogueMatches].slice(0, limit);
}
