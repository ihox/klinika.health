import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import { Icd10SearchQuerySchema, type Icd10ResultDto } from './icd10.dto';
import { Icd10Service } from './icd10.service';

/**
 * ICD-10 search.
 *
 *   GET /api/icd10/search?q=<query>&limit=<n>
 *
 * Doctor-only. The "doctorId" implicit in the spec is derived from
 * the authenticated session — never accepted from the query — so a
 * client cannot peek at another doctor's frequently-used list.
 *
 * No mutations live here; usage counts are bumped at visit-save time
 * inside {@link VisitsService} so the writes share the same audit-log
 * coalescing window as the visit PATCH.
 */
@Controller('api/icd10')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class Icd10Controller {
  constructor(private readonly icd10: Icd10Service) {}

  @Get('search')
  @Roles('doctor', 'clinic_admin')
  async search(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<{ results: Icd10ResultDto[] }> {
    const parsed = Icd10SearchQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Kërkimi i pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.icd10.search(ctx, parsed.data.q, parsed.data.limit);
  }
}
