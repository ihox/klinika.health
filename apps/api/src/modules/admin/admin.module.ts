import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HealthModule } from '../health/health.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AdminHealthController } from './admin-health.controller';
import { AdminHealthService } from './admin-health.service';
import { AdminMfaService } from './admin-mfa.service';
import { AdminPlatformAdminsController } from './admin-platform-admins.controller';
import { AdminPlatformAdminsService } from './admin-platform-admins.service';
import { AdminSessionService } from './admin-session.service';
import { AdminTenantsController } from './admin-tenants.controller';
import { AdminTenantsService } from './admin-tenants.service';
import { PlatformAuditService } from './platform-audit.service';

@Module({
  imports: [AuthModule, HealthModule, RateLimitModule],
  controllers: [
    AdminAuthController,
    AdminTenantsController,
    AdminPlatformAdminsController,
    AdminHealthController,
  ],
  providers: [
    AdminAuthGuard,
    AdminAuthService,
    AdminSessionService,
    AdminMfaService,
    AdminTenantsService,
    AdminPlatformAdminsService,
    AdminHealthService,
    PlatformAuditService,
  ],
  exports: [AdminAuthGuard, AdminSessionService, PlatformAuditService],
})
export class AdminModule {}
