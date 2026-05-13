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
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminScope } from '../../common/decorators/allow-anonymous.decorator';
import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestContext } from '../../common/request-context/request-context';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminTenantsService } from './admin-tenants.service';
import {
  CreateTenantRequestSchema,
  SubdomainAvailabilityQuerySchema,
  type TenantDetail,
  type TenantSummary,
} from './admin.dto';

@Controller('api/admin/tenants')
@AdminScope()
@UseGuards(AdminAuthGuard)
@Roles('platform_admin')
export class AdminTenantsController {
  constructor(private readonly tenants: AdminTenantsService) {}

  @Get()
  async list(): Promise<{ tenants: TenantSummary[] }> {
    const tenants = await this.tenants.listTenants();
    return { tenants };
  }

  /**
   * Live subdomain check as the user types in the create form.
   * Anything that would fail server-side validation (invalid chars,
   * reserved, taken) returns `available: false` with a reason — the UI
   * shows it inline. Always returns 200 so a 404 doesn't trip the
   * fetch wrapper on a fresh, valid subdomain.
   */
  @Get('subdomain-availability')
  async checkAvailability(@Query('subdomain') subdomain?: string): Promise<{
    available: boolean;
    subdomain: string;
    reason?: string;
  }> {
    const parsed = SubdomainAvailabilityQuerySchema.safeParse({ subdomain: subdomain ?? '' });
    if (!parsed.success) {
      return { available: false, subdomain: subdomain ?? '', reason: 'Subdomain është i pavlefshëm.' };
    }
    return this.tenants.checkSubdomainAvailability(parsed.data.subdomain);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @Ctx() ctx: RequestContext): Promise<{ tenant: TenantDetail }> {
    const parsed = CreateTenantRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const tenant = await this.tenants.createTenant(parsed.data, {
      platformAdminId: ctx.userId!,
      sessionId: ctx.sessionId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { tenant };
  }

  @Get(':id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string): Promise<{ tenant: TenantDetail }> {
    const tenant = await this.tenants.getTenant(id);
    return { tenant };
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  async suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: RequestContext,
  ): Promise<{ tenant: TenantDetail }> {
    const note = typeof (body as { note?: unknown }).note === 'string'
      ? ((body as { note: string }).note as string).slice(0, 500)
      : undefined;
    const tenant = await this.tenants.setStatus(
      id,
      'suspended',
      {
        platformAdminId: ctx.userId!,
        sessionId: ctx.sessionId,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
      note,
    );
    return { tenant };
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: RequestContext,
  ): Promise<{ tenant: TenantDetail }> {
    const tenant = await this.tenants.setStatus(id, 'active', {
      platformAdminId: ctx.userId!,
      sessionId: ctx.sessionId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { tenant };
  }
}
