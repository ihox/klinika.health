import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import {
  CreateVisitSchema,
  UpdateVisitSchema,
  VisitHistoryQuerySchema,
  type VisitDto,
  type VisitHistoryEntryDto,
} from './visits.dto';
import { VisitsService } from './visits.service';

/**
 * Visit API surface.
 *
 *   POST   /api/visits                  — create a new visit (doctor)
 *   POST   /api/visits/doctor-new       — doctor-initiated "Vizitë e re"
 *                                         with auto-pairing to today's
 *                                         in-progress booking
 *   GET    /api/visits/:id              — full visit record (doctor)
 *   PATCH  /api/visits/:id              — delta save (doctor — auto-save target)
 *   DELETE /api/visits/:id              — soft delete (doctor)
 *   POST   /api/visits/:id/restore      — restore within the 30s undo window
 *   GET    /api/visits/:id/history      — change history (audit log)
 *
 * All endpoints are doctor / clinic-admin only — the receptionist
 * privacy boundary (CLAUDE.md §1.2) keeps the receptionist out.
 */
@Controller('api/visits')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class VisitsController {
  constructor(private readonly visits: VisitsService) {}

  @Post()
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ visit: VisitDto }> {
    const parsed = CreateVisitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const visit = await this.visits.create(ctx.clinicId!, parsed.data, ctx);
    return { visit };
  }

  /**
   * Doctor-initiated "Vizitë e re" with auto-pairing. Same payload as
   * the legacy `POST /api/visits`; the server decides whether the new
   * row becomes a paired walk-in (today's in-progress booking is
   * unpaired) or a standalone chart entry (no pairing available).
   *
   * Registered as a fixed sub-path so Express matches it before the
   * `:id` patterns below — `'doctor-new'` is not a UUID so it would
   * fall through the ParseUUIDPipe anyway, but explicit ordering keeps
   * the route table readable.
   */
  @Post('doctor-new')
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.CREATED)
  async createDoctorNew(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ visit: VisitDto }> {
    const parsed = CreateVisitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const visit = await this.visits.createDoctorNew(ctx.clinicId!, parsed.data, ctx);
    return { visit };
  }

  @Get(':id')
  @Roles('doctor', 'clinic_admin')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ visit: VisitDto }> {
    const visit = await this.visits.getById(ctx.clinicId!, id, ctx);
    return { visit };
  }

  @Patch(':id')
  @Roles('doctor', 'clinic_admin')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ visit: VisitDto }> {
    const parsed = UpdateVisitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const visit = await this.visits.update(ctx.clinicId!, id, parsed.data, ctx);
    return { visit };
  }

  @Delete(':id')
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok'; restorableUntil: string }> {
    return this.visits.softDelete(ctx.clinicId!, id, ctx);
  }

  @Post(':id/restore')
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ visit: VisitDto }> {
    const visit = await this.visits.restore(ctx.clinicId!, id, ctx);
    return { visit };
  }

  @Get(':id/history')
  @Roles('doctor', 'clinic_admin')
  async history(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<{ entries: VisitHistoryEntryDto[] }> {
    const parsed = VisitHistoryQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Kërkimi i pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.visits.getHistory(ctx.clinicId!, id, ctx, parsed.data.limit);
  }
}
