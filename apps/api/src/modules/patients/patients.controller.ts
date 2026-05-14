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
import type { PatientChartDto } from './patient-chart.dto';
import { PatientChartService } from './patient-chart.service';
import {
  DoctorCreatePatientSchema,
  DoctorUpdatePatientSchema,
  type PatientFullDto,
  type PatientPublicDto,
  PatientSearchQuerySchema,
  ReceptionistCreatePatientSchema,
} from './patients.dto';
import { PatientsService } from './patients.service';

/**
 * Patient API surface.
 *
 *   POST /api/patients           — create (receptionist OR doctor — body
 *                                  shape differs by role; see DTOs)
 *   GET  /api/patients           — search (returns role-scoped DTOs)
 *   GET  /api/patients/:id       — full record (DOCTOR / CLINIC_ADMIN ONLY)
 *   PATCH /api/patients/:id      — update (DOCTOR / CLINIC_ADMIN ONLY)
 *   DELETE /api/patients/:id     — soft delete (DOCTOR / CLINIC_ADMIN ONLY)
 *   POST /api/patients/:id/restore — restore within the 30s undo window
 *   POST /api/patients/duplicate-check — informational duplicate notice
 *
 * Role-based response filtering: search results are serialised via
 * `toPublicDto` for receptionists (id + firstName + lastName + dob),
 * never anything else. See CLAUDE.md §1.2.
 */
@Controller('api/patients')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class PatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly chart: PatientChartService,
  ) {}

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  @Get()
  async search(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<{ patients: Array<PatientPublicDto | PatientFullDto> }> {
    const parsed = PatientSearchQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Kërkimi i pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    const role = ctx.role;
    if (role === 'platform_admin' || role == null) {
      throw new BadRequestException('Roli nuk ka qasje në pacientët.');
    }
    return this.patients.search(ctx.clinicId!, parsed.data, role);
  }

  // -------------------------------------------------------------------------
  // Soft duplicate check
  // -------------------------------------------------------------------------

  @Post('duplicate-check')
  @HttpCode(HttpStatus.OK)
  async duplicateCheck(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ candidates: PatientPublicDto[] }> {
    // Soft-duplicate is purely advisory; both receptionist and doctor
    // can hit it. The response is always PatientPublicDto — even a
    // doctor doesn't need full records for this check.
    const parsed = ReceptionistCreatePatientSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const candidates = await this.patients.findLikelyDuplicates(
      ctx.clinicId!,
      parsed.data.firstName,
      parsed.data.lastName,
      parsed.data.dateOfBirth ?? null,
    );
    return { candidates };
  }

  // -------------------------------------------------------------------------
  // Create (role-dispatched)
  // -------------------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ patient: PatientPublicDto | PatientFullDto }> {
    if (ctx.role === 'receptionist') {
      // Receptionist body MUST satisfy the minimal schema. Anything
      // else (address, phone, alergji…) is silently dropped by
      // `.strict()` — a tampered client posting a full body sees no
      // error but no extra data is stored.
      const parsed = ReceptionistCreatePatientSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException({
          message: 'Të dhëna të pavlefshme.',
          issues: parsed.error.flatten(),
        });
      }
      const patient = await this.patients.createMinimal(ctx.clinicId!, parsed.data, ctx);
      return { patient };
    }
    if (ctx.role === 'doctor' || ctx.role === 'clinic_admin') {
      const parsed = DoctorCreatePatientSchema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestException({
          message: 'Të dhëna të pavlefshme.',
          issues: parsed.error.flatten(),
        });
      }
      const patient = await this.patients.createFull(ctx.clinicId!, parsed.data, ctx);
      return { patient };
    }
    throw new BadRequestException('Roli nuk lejohet të krijojë pacientë.');
  }

  // -------------------------------------------------------------------------
  // Get one (DOCTOR / CLINIC_ADMIN ONLY)
  // -------------------------------------------------------------------------

  @Get(':id')
  @Roles('doctor', 'clinic_admin')
  async getOne(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ patient: PatientFullDto }> {
    const patient = await this.patients.getById(ctx.clinicId!, id, ctx);
    return { patient };
  }

  // -------------------------------------------------------------------------
  // Full chart bundle (master + visits + vërtetime) — DOCTOR ONLY
  // -------------------------------------------------------------------------
  //
  // The chart shell needs all three resources to render the master
  // strip, the visit navigation/history list, and the vërtetime
  // panel. Returning them in one shot avoids a request waterfall on
  // page open.

  @Get(':id/chart')
  @Roles('doctor', 'clinic_admin')
  async getChart(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<PatientChartDto> {
    return this.chart.getChart(ctx.clinicId!, id, ctx);
  }

  // -------------------------------------------------------------------------
  // Update (DOCTOR / CLINIC_ADMIN ONLY)
  // -------------------------------------------------------------------------

  @Patch(':id')
  @Roles('doctor', 'clinic_admin')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ patient: PatientFullDto }> {
    const parsed = DoctorUpdatePatientSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const patient = await this.patients.update(ctx.clinicId!, id, parsed.data, ctx);
    return { patient };
  }

  // -------------------------------------------------------------------------
  // Soft delete + restore (DOCTOR / CLINIC_ADMIN ONLY)
  // -------------------------------------------------------------------------

  @Delete(':id')
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.OK)
  async softDelete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok'; restorableUntil: string }> {
    return this.patients.softDelete(ctx.clinicId!, id, ctx);
  }

  @Post(':id/restore')
  @Roles('doctor', 'clinic_admin')
  @HttpCode(HttpStatus.OK)
  async restore(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ patient: PatientFullDto }> {
    const patient = await this.patients.restore(ctx.clinicId!, id, ctx);
    return { patient };
  }
}
