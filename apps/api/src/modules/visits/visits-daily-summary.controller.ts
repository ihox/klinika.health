import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Ctx } from '../../common/decorators/ctx.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import {
  type DailySummaryResponse,
  DailySummaryQuerySchema,
} from './visits-daily-summary.dto';
import { VisitsDailySummaryService } from './visits-daily-summary.service';

/**
 * Raporti i ditës — daily revenue + visit report.
 *
 *   GET /api/visits/daily-summary?date=YYYY-MM-DD
 *
 * Accessible to doctor, receptionist, and clinic_admin per ADR-019
 * (the named carve-out from CLAUDE.md §1.2). Receptionist callers are
 * server-restricted to today and yesterday in `Europe/Belgrade`; any
 * other date returns 403 with `reason: 'date_out_of_range'`.
 *
 * Platform admins are blocked at the role check below — they live on
 * the apex domain and don't read clinic operational state.
 *
 * The controller is mounted on `api/visits` (same prefix as the
 * calendar + CRUD controllers) and registered BEFORE
 * `VisitsController` in `visits.module.ts` so Express resolves the
 * `daily-summary` path before the catch-all `:id` patterns. Don't
 * reorder.
 */
@Controller('api/visits')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class VisitsDailySummaryController {
  constructor(private readonly summary: VisitsDailySummaryService) {}

  @Get('daily-summary')
  async dailySummary(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<DailySummaryResponse> {
    this.assertClinicalScopeRole(ctx);
    const parsed = DailySummaryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Parametra të pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.summary.summary(ctx.clinicId!, parsed.data.date, ctx);
  }

  private assertClinicalScopeRole(ctx: RequestContext): void {
    if (!ctx.roles || ctx.roles.length === 0 || ctx.roles.includes('platform_admin')) {
      throw new ForbiddenException('Roli juaj nuk ka qasje në këtë veprim.');
    }
    if (
      !ctx.roles.includes('doctor') &&
      !ctx.roles.includes('receptionist') &&
      !ctx.roles.includes('clinic_admin')
    ) {
      throw new ForbiddenException('Roli juaj nuk ka qasje në këtë veprim.');
    }
  }
}
