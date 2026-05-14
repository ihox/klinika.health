import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import {
  type AppointmentDto,
  type AppointmentListResponse,
  type AppointmentStatsResponse,
  AppointmentRangeQuerySchema,
  AppointmentStatsQuerySchema,
  CreateAppointmentSchema,
  type SoftDeleteResponse,
  UpdateAppointmentSchema,
} from './appointments.dto';
import { AppointmentsEventsService } from './appointments.events';
import { AppointmentsService } from './appointments.service';

@Controller('api/appointments')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class AppointmentsController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly events: AppointmentsEventsService,
  ) {}

  // -------------------------------------------------------------------------
  // List a date range
  // -------------------------------------------------------------------------

  @Get()
  async list(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<AppointmentListResponse> {
    this.assertCalendarRole(ctx);
    const parsed = AppointmentRangeQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Parametra të pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.appointments.listRange(ctx.clinicId!, parsed.data);
  }

  // -------------------------------------------------------------------------
  // Stats for a single day
  // -------------------------------------------------------------------------

  @Get('stats')
  async stats(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<AppointmentStatsResponse> {
    this.assertCalendarRole(ctx);
    const parsed = AppointmentStatsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Parametra të pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.appointments.statsForDay(ctx.clinicId!, parsed.data.date);
  }

  // -------------------------------------------------------------------------
  // Unmarked-yesterday prompt
  // -------------------------------------------------------------------------

  @Get('unmarked-past')
  async unmarkedPast(
    @Ctx() ctx: RequestContext,
  ): Promise<{ appointments: AppointmentDto[] }> {
    this.assertCalendarRole(ctx);
    const appointments = await this.appointments.listUnmarkedPast(ctx.clinicId!);
    return { appointments };
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async create(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ appointment: AppointmentDto }> {
    const parsed = CreateAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const appointment = await this.appointments.create(ctx.clinicId!, parsed.data, ctx);
    return { appointment };
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  @Patch(':id')
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ appointment: AppointmentDto }> {
    const parsed = UpdateAppointmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const appointment = await this.appointments.update(ctx.clinicId!, id, parsed.data, ctx);
    return { appointment };
  }

  // -------------------------------------------------------------------------
  // Soft delete + restore
  // -------------------------------------------------------------------------

  @Delete(':id')
  @Roles('receptionist', 'doctor', 'clinic_admin')
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<SoftDeleteResponse> {
    return this.appointments.softDelete(ctx.clinicId!, id, ctx);
  }

  @Post(':id/restore')
  @Roles('receptionist', 'doctor', 'clinic_admin')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ appointment: AppointmentDto }> {
    const appointment = await this.appointments.restore(ctx.clinicId!, id, ctx);
    return { appointment };
  }

  // -------------------------------------------------------------------------
  // SSE — real-time appointment updates
  // -------------------------------------------------------------------------
  //
  // We keep the channel clinic-scoped (the bus filters by `clinicId`)
  // and payloads metadata-only: every event carries the appointment id
  // plus its local day so the receptionist's TanStack Query cache can
  // be invalidated by date range. No patient names ever travel through
  // SSE (CLAUDE.md §1.3).

  @Get('stream')
  stream(
    @Req() req: Request,
    @Res() res: Response,
    @Ctx() ctx: RequestContext,
  ): void {
    this.assertCalendarRole(ctx);
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`: connected\n\n`);

    const unsubscribe = this.events.subscribe(ctx.clinicId!, (event) => {
      try {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Best-effort; the close handler unsubscribes anyway.
      }
    });

    // Heartbeat every 25s to keep proxies (Caddy / Cloudflare) from
    // closing the idle connection at 30s.
    const heartbeat = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Calendar endpoints are intentionally open to receptionist + doctor +
   * clinic_admin — none of them expose PHI beyond name/DOB. Platform
   * admins are blocked at this layer (they shouldn't be reading clinic
   * scheduling state).
   */
  private assertCalendarRole(ctx: RequestContext): void {
    if (ctx.role === 'platform_admin' || ctx.role == null) {
      throw new ForbiddenException('Roli nuk ka qasje në kalendarin.');
    }
  }
}
