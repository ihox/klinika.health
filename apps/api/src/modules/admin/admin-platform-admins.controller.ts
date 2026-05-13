import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import { AdminScope } from '../../common/decorators/allow-anonymous.decorator';
import { Ctx } from '../../common/decorators/ctx.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { RequestContext } from '../../common/request-context/request-context';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminPlatformAdminsService } from './admin-platform-admins.service';
import {
  CreatePlatformAdminRequestSchema,
  type PlatformAdminSummary,
} from './admin.dto';

@Controller('api/admin/platform-admins')
@AdminScope()
@UseGuards(AdminAuthGuard)
@Roles('platform_admin')
export class AdminPlatformAdminsController {
  constructor(private readonly admins: AdminPlatformAdminsService) {}

  @Get()
  async list(): Promise<{ admins: PlatformAdminSummary[] }> {
    const admins = await this.admins.list();
    return { admins };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: unknown, @Ctx() ctx: RequestContext): Promise<{ admin: PlatformAdminSummary }> {
    const parsed = CreatePlatformAdminRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Të dhëna të pavlefshme.',
        issues: parsed.error.flatten(),
      });
    }
    const admin = await this.admins.create(parsed.data, {
      platformAdminId: ctx.userId!,
      sessionId: ctx.sessionId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    return { admin };
  }
}
