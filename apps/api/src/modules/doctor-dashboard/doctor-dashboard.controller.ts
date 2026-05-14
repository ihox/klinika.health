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
import {
  DashboardQuerySchema,
  type DoctorDashboardResponse,
} from './doctor-dashboard.dto';
import { DoctorDashboardService } from './doctor-dashboard.service';

@Controller('api/doctor/dashboard')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class DoctorDashboardController {
  constructor(private readonly dashboard: DoctorDashboardService) {}

  // Single-endpoint dashboard: the doctor's home polls this every 60s
  // and pulls everything (appointments, visits, next patient, stats)
  // in one round-trip. Lighter on the server than four separate
  // calls and easier to keep internally consistent (all numbers
  // belong to the same instant).
  @Get()
  @Roles('doctor', 'clinic_admin')
  async get(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<DoctorDashboardResponse> {
    const parsed = DashboardQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Parametra të pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.dashboard.getDashboard(ctx.clinicId!, ctx, parsed.data.date);
  }
}
