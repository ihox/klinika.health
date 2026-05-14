import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthGuard } from '../../common/guards/auth.guard';
import { ClinicScopeGuard } from '../../common/guards/clinic-scope.guard';
import type { RequestContext } from '../../common/request-context/request-context';
import {
  AuditQuerySchema,
  ClinicGeneralUpdateSchema,
  type ClinicSettingsResponse,
  type ClinicUserRow,
  CreateUserRequestSchema,
  HoursConfigSchema,
  LogoUploadSchema,
  PaymentCodesSchema,
  SetUserActiveSchema,
  SignatureUploadSchema,
  SmtpTestRequestSchema,
  SmtpUpdateRequestSchema,
  UpdateUserRequestSchema,
} from './clinic-settings.dto';
import { ClinicAuditService } from './clinic-audit.service';
import { ClinicSettingsService } from './clinic-settings.service';
import { ClinicStorageService, type LogoContentType } from './clinic-storage.service';
import { ClinicUsersService } from './clinic-users.service';
import { SmtpTestService } from './smtp-test.service';
import { SvgRejectedError } from './svg-sanitizer';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 1 * 1024 * 1024;

@Controller('api/clinic')
@UseGuards(AuthGuard, ClinicScopeGuard)
export class ClinicSettingsController {
  constructor(
    private readonly settings: ClinicSettingsService,
    private readonly users: ClinicUsersService,
    private readonly audit: ClinicAuditService,
    private readonly storage: ClinicStorageService,
    private readonly smtpTest: SmtpTestService,
    private readonly auditLog: AuditLogService,
  ) {}

  // ---- Settings root ----------------------------------------------------

  @Get('settings')
  async getSettings(@Ctx() ctx: RequestContext): Promise<ClinicSettingsResponse> {
    return this.settings.getSettings(ctx.clinicId!);
  }

  @Put('settings/general')
  @Roles('clinic_admin')
  async updateGeneral(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = ClinicGeneralUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    return this.settings.updateGeneral(ctx.clinicId!, parsed.data, ctx);
  }

  @Put('settings/hours')
  @Roles('clinic_admin')
  async updateHours(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = HoursConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Orari i pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.settings.updateHours(ctx.clinicId!, parsed.data, ctx);
  }

  @Put('settings/payment-codes')
  @Roles('clinic_admin')
  async updatePaymentCodes(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = PaymentCodesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Kodet e pagesave janë të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    return this.settings.updatePaymentCodes(ctx.clinicId!, parsed.data, ctx);
  }

  @Put('settings/email')
  @Roles('clinic_admin')
  async updateEmail(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = SmtpUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Konfigurimi i SMTP-së është i pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.settings.updateEmailMode(ctx.clinicId!, parsed.data, ctx);
  }

  @Post('settings/email/test')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.OK)
  async testEmail(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ ok: boolean; detail: string; reason?: string }> {
    const parsedTarget = SmtpTestRequestSchema.safeParse(body);
    const parsedConfig = SmtpUpdateRequestSchema.safeParse(body);
    if (!parsedTarget.success || !parsedConfig.success) {
      throw new BadRequestException('Të dhëna të pavlefshme për testimin e SMTP-së.');
    }
    if (parsedConfig.data.mode !== 'smtp') {
      throw new BadRequestException('Vetëm konfigurimi SMTP mund të testohet.');
    }
    const cfg = parsedConfig.data;
    // Reuse the stored password if the user didn't type one.
    let password = cfg.password;
    if (!password) {
      const decrypted = await this.settings.getDecryptedSmtpPassword(ctx.clinicId!);
      if (!decrypted) {
        throw new BadRequestException(
          'Vendos fjalëkalimin SMTP — nuk është ruajtur fjalëkalim i mëparshëm.',
        );
      }
      password = decrypted;
    }
    const clinic = await this.settings.getSettings(ctx.clinicId!);
    const result = await this.smtpTest.runTest({
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      password,
      fromName: cfg.fromName,
      fromAddress: cfg.fromAddress,
      toEmail: parsedTarget.data.toEmail,
      clinicName: clinic.general.name,
    });
    await this.auditLog.record({
      ctx,
      action: result.ok ? 'settings.email.tested' : 'settings.email.test_failed',
      resourceType: 'clinic',
      resourceId: ctx.clinicId!,
      changes: [
        { field: 'host', old: null, new: cfg.host },
        { field: 'port', old: null, new: cfg.port },
        ...(result.ok ? [] : [{ field: 'reason', old: null, new: result.reason ?? 'unknown' }]),
      ],
    });
    return result;
  }

  // ---- Branding -------------------------------------------------------

  @Post('settings/branding/logo')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.OK)
  async uploadLogo(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = LogoUploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Logo e pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const bytes = Buffer.from(parsed.data.dataBase64.replace(/\s/g, ''), 'base64');
    if (bytes.length === 0) {
      throw new BadRequestException('Skedari është bosh.');
    }
    if (bytes.length > MAX_LOGO_BYTES) {
      throw new BadRequestException('Logo nuk mund të kalojë 2 MB.');
    }
    try {
      await this.storage.writeLogo(
        ctx.clinicId!,
        parsed.data.contentType as LogoContentType,
        bytes,
      );
    } catch (err: unknown) {
      if (err instanceof SvgRejectedError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    await this.auditLog.record({
      ctx,
      action: 'settings.branding.logo_updated',
      resourceType: 'clinic',
      resourceId: ctx.clinicId!,
      changes: [
        { field: 'contentType', old: null, new: parsed.data.contentType },
        { field: 'bytes', old: null, new: bytes.length },
      ],
    });
    return this.settings.getSettings(ctx.clinicId!);
  }

  @Delete('settings/branding/logo')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.OK)
  async removeLogo(@Ctx() ctx: RequestContext): Promise<ClinicSettingsResponse> {
    await this.storage.removeLogo(ctx.clinicId!);
    await this.auditLog.record({
      ctx,
      action: 'settings.branding.logo_removed',
      resourceType: 'clinic',
      resourceId: ctx.clinicId!,
      changes: null,
    });
    return this.settings.getSettings(ctx.clinicId!);
  }

  @Post('settings/branding/signature')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.OK)
  async uploadSignature(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<ClinicSettingsResponse> {
    const parsed = SignatureUploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Nënshkrimi i pavlefshëm.');
    }
    const bytes = Buffer.from(parsed.data.dataBase64.replace(/\s/g, ''), 'base64');
    if (bytes.length === 0) {
      throw new BadRequestException('Skedari është bosh.');
    }
    if (bytes.length > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException('Nënshkrimi nuk mund të kalojë 1 MB.');
    }
    await this.storage.writeClinicSignature(ctx.clinicId!, bytes);
    await this.auditLog.record({
      ctx,
      action: 'settings.branding.signature_updated',
      resourceType: 'clinic',
      resourceId: ctx.clinicId!,
      changes: [{ field: 'bytes', old: null, new: bytes.length }],
    });
    return this.settings.getSettings(ctx.clinicId!);
  }

  @Delete('settings/branding/signature')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.OK)
  async removeSignature(@Ctx() ctx: RequestContext): Promise<ClinicSettingsResponse> {
    await this.storage.removeClinicSignature(ctx.clinicId!);
    await this.auditLog.record({
      ctx,
      action: 'settings.branding.signature_removed',
      resourceType: 'clinic',
      resourceId: ctx.clinicId!,
      changes: null,
    });
    return this.settings.getSettings(ctx.clinicId!);
  }

  /**
   * Authenticated proxy that serves the clinic logo. Sets a private
   * cache header — logos rarely change but live behind auth. The path
   * is stable (`/api/clinic/logo`) so printed templates can hard-code
   * the relative URL without knowing the file extension.
   */
  @Get('logo')
  async getLogo(@Ctx() ctx: RequestContext, @Res() res: Response): Promise<void> {
    const logo = await this.storage.readLogo(ctx.clinicId!);
    if (!logo) throw new NotFoundException('Logo nuk është ngarkuar.');
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(logo.bytes);
  }

  @Get('signature')
  async getSignature(@Ctx() ctx: RequestContext, @Res() res: Response): Promise<void> {
    const bytes = await this.storage.readClinicSignature(ctx.clinicId!);
    if (!bytes) throw new NotFoundException('Nënshkrimi nuk është ngarkuar.');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(bytes);
  }

  // ---- Users ----------------------------------------------------------

  @Get('users')
  async listUsers(@Ctx() ctx: RequestContext): Promise<{ users: ClinicUserRow[] }> {
    return { users: await this.users.list(ctx.clinicId!) };
  }

  @Post('users')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ user: ClinicUserRow }> {
    const parsed = CreateUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const user = await this.users.create(ctx.clinicId!, parsed.data, ctx);
    return { user };
  }

  @Put('users/:id')
  @Roles('clinic_admin')
  async updateUser(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ user: ClinicUserRow }> {
    const parsed = UpdateUserRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const user = await this.users.update(ctx.clinicId!, id, parsed.data, ctx);
    return { user };
  }

  @Post('users/:id/active')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.OK)
  async setUserActive(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ user: ClinicUserRow }> {
    const parsed = SetUserActiveSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Të dhëna të pavlefshme.');
    }
    const user = await this.users.setActive(ctx.clinicId!, id, parsed.data.isActive, ctx);
    return { user };
  }

  @Post('users/:id/password-reset')
  @Roles('clinic_admin')
  @HttpCode(HttpStatus.OK)
  async sendUserPasswordReset(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok' }> {
    await this.users.sendPasswordReset(ctx.clinicId!, id, ctx);
    return { status: 'ok' };
  }

  @Post('users/:id/signature')
  @Roles('clinic_admin', 'doctor')
  @HttpCode(HttpStatus.OK)
  async uploadUserSignature(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ status: 'ok' }> {
    // A doctor can upload their own signature; clinic admins can
    // upload any doctor's signature.
    if (ctx.role === 'doctor' && ctx.userId !== id) {
      throw new BadRequestException('Mund të ngarkoni vetëm nënshkrimin tuaj.');
    }
    const parsed = SignatureUploadSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Nënshkrimi i pavlefshëm.');
    }
    const bytes = Buffer.from(parsed.data.dataBase64.replace(/\s/g, ''), 'base64');
    if (bytes.length === 0 || bytes.length > MAX_SIGNATURE_BYTES) {
      throw new BadRequestException('Nënshkrimi është i madh ose bosh.');
    }
    await this.storage.writeUserSignature(ctx.clinicId!, id, bytes);
    await this.auditLog.record({
      ctx,
      action: 'settings.user.signature_updated',
      resourceType: 'user',
      resourceId: id,
      changes: [{ field: 'bytes', old: null, new: bytes.length }],
    });
    return { status: 'ok' };
  }

  @Get('users/:id/signature')
  async getUserSignature(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
    @Res() res: Response,
  ): Promise<void> {
    const bytes = await this.storage.readUserSignature(ctx.clinicId!, id);
    if (!bytes) throw new NotFoundException('Nënshkrimi nuk është ngarkuar.');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(bytes);
  }

  // ---- Audit log -----------------------------------------------------

  @Get('audit')
  async queryAudit(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
  ): Promise<{ rows: unknown; nextCursor: string | null }> {
    const parsed = AuditQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Filtër i pavlefshëm.',
        issues: parsed.error.flatten(),
      });
    }
    return this.audit.query(ctx.clinicId!, parsed.data);
  }

  @Get('audit/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportAudit(
    @Query() query: Record<string, string>,
    @Ctx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const parsed = AuditQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException('Filtër i pavlefshëm.');
    }
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="auditimi-${today}.csv"`,
    );
    return this.audit.exportCsv(ctx.clinicId!, parsed.data);
  }
}
