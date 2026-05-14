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
  type CalendarAvailabilityResponse,
  CalendarAvailabilityQuerySchema,
  type CalendarEntryDto,
  type CalendarListResponse,
  type CalendarStatsResponse,
  CalendarRangeQuerySchema,
  CalendarStatsQuerySchema,
  CreateScheduledVisitSchema,
  CreateWalkinVisitSchema,
  type SoftDeleteResponse,
  UpdateScheduledVisitSchema,
  UpdateVisitStatusSchema,
} from './visits-calendar.dto';
import { VisitsCalendarEventsService } from './visits-calendar.events';
import { VisitsCalendarService } from './visits-calendar.service';

/**
 * Receptionist + doctor + clinic_admin calendar surface.
 *
 *   GET    /api/visits/calendar                  list a date range
 *   GET    /api/visits/calendar/stats            stats for one day
 *   GET    /api/visits/calendar/availability     per-duration verdicts
 *   GET    /api/visits/calendar/unmarked-past    stale 'scheduled' prompt
 *   GET    /api/visits/calendar/stream           SSE — visit.* lifecycle
 *   POST   /api/visits/scheduled                 create a booking
 *   POST   /api/visits/walkin                    create a walk-in
 *   PATCH  /api/visits/:id/scheduling            move date/time/duration
 *   PATCH  /api/visits/:id/status                status transition (validated)
 *   DELETE /api/visits/calendar/:id              soft-delete (30s undo)
 *   POST   /api/visits/calendar/:id/restore      restore within the window
 *
 * Platform admins are blocked at the role check — they don't read clinic
 * scheduling state. The receptionist privacy boundary (CLAUDE.md §1.2)
 * stays intact at the DTO layer (only firstName/lastName/dateOfBirth).
 */
@Controller('api/visits')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class VisitsCalendarController {
  constructor(
    private readonly calendar: VisitsCalendarService,
    private readonly events: VisitsCalendarEventsService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  @Get('calendar')
  async list(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<CalendarListResponse> {
    this.assertCalendarRole(ctx);
    const parsed = CalendarRangeQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Parametra të pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.calendar.listRange(ctx.clinicId!, parsed.data, ctx);
  }

  @Get('calendar/stats')
  async stats(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<CalendarStatsResponse> {
    this.assertCalendarRole(ctx);
    const parsed = CalendarStatsQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Parametra të pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.calendar.statsForDay(ctx.clinicId!, parsed.data.date);
  }

  @Get('calendar/availability')
  async availability(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<CalendarAvailabilityResponse> {
    this.assertCalendarRole(ctx);
    const parsed = CalendarAvailabilityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Parametra të pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.calendar.availability(
      ctx.clinicId!,
      parsed.data.date,
      parsed.data.time,
      parsed.data.excludeVisitId ?? null,
    );
  }

  @Get('calendar/unmarked-past')
  async unmarkedPast(
    @Ctx() ctx: RequestContext,
  ): Promise<{ entries: CalendarEntryDto[] }> {
    this.assertCalendarRole(ctx);
    const entries = await this.calendar.listUnmarkedPast(ctx.clinicId!, ctx);
    return { entries };
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  @Post('scheduled')
  @HttpCode(HttpStatus.CREATED)
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async createScheduled(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ entry: CalendarEntryDto }> {
    const parsed = CreateScheduledVisitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const entry = await this.calendar.createScheduled(ctx.clinicId!, parsed.data, ctx);
    return { entry };
  }

  @Post('walkin')
  @HttpCode(HttpStatus.CREATED)
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async createWalkin(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ entry: CalendarEntryDto }> {
    const parsed = CreateWalkinVisitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const entry = await this.calendar.createWalkin(ctx.clinicId!, parsed.data, ctx);
    return { entry };
  }

  @Patch(':id/scheduling')
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async updateScheduling(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ entry: CalendarEntryDto }> {
    const parsed = UpdateScheduledVisitSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const entry = await this.calendar.updateScheduled(ctx.clinicId!, id, parsed.data, ctx);
    return { entry };
  }

  @Patch(':id/status')
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ entry: CalendarEntryDto }> {
    const parsed = UpdateVisitStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const entry = await this.calendar.changeStatus(ctx.clinicId!, id, parsed.data, ctx);
    return { entry };
  }

  @Delete('calendar/:id')
  @HttpCode(HttpStatus.OK)
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<SoftDeleteResponse> {
    return this.calendar.softDelete(ctx.clinicId!, id, ctx);
  }

  @Post('calendar/:id/restore')
  @HttpCode(HttpStatus.OK)
  @Roles('receptionist', 'doctor', 'clinic_admin')
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ entry: CalendarEntryDto }> {
    const entry = await this.calendar.restore(ctx.clinicId!, id, ctx);
    return { entry };
  }

  // -------------------------------------------------------------------------
  // SSE — real-time visit lifecycle
  // -------------------------------------------------------------------------
  //
  // The doctor's home dashboard subscribes to this stream alongside the
  // receptionist's calendar. Payloads carry IDs + local-day anchors only
  // — never patient names (CLAUDE.md §1.3).

  @Get('calendar/stream')
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

  private assertCalendarRole(ctx: RequestContext): void {
    if (!ctx.roles || ctx.roles.length === 0 || ctx.roles.includes('platform_admin')) {
      throw new ForbiddenException('Roli nuk ka qasje në kalendarin.');
    }
  }
}
