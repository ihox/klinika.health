import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import { IssueVertetimSchema, type VertetimDto } from './vertetim.dto';
import { VertetimService } from './vertetim.service';

/**
 * Vërtetim API.
 *
 *   POST /api/vertetim          — issue a new vërtetim (doctor only)
 *   GET  /api/vertetim/:id      — fetch one (doctor only)
 *
 * Print delivery is in `/api/print/vertetim/:id`.
 */
@Controller('api/vertetim')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class VertetimController {
  constructor(private readonly vertetim: VertetimService) {}

  @Post()
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.CREATED)
  async issue(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ vertetim: VertetimDto }> {
    const parsed = IssueVertetimSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const vertetim = await this.vertetim.issue(ctx.clinicId!, parsed.data, ctx);
    return { vertetim };
  }

  @Get(':id')
  @Roles('doctor', 'clinic_admin')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ vertetim: VertetimDto }> {
    const vertetim = await this.vertetim.getById(ctx.clinicId!, id, ctx);
    return { vertetim };
  }
}
