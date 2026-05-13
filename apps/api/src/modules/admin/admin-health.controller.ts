import { Controller, Get, UseGuards } from '@nestjs/common';

import { AdminScope } from '../../common/decorators/allow-anonymous.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminHealthService } from './admin-health.service';
import type { PlatformHealthSnapshot } from './admin.dto';

@Controller('api/admin/health')
@AdminScope()
@UseGuards(AdminAuthGuard)
@Roles('platform_admin')
export class AdminHealthController {
  constructor(private readonly health: AdminHealthService) {}

  @Get()
  async snapshot(): Promise<PlatformHealthSnapshot> {
    return this.health.snapshot();
  }
}
