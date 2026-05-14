import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AuditModule } from './common/audit/audit.module';
import { ClinicResolutionMiddleware } from './common/middleware/clinic-resolution.middleware';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingModule } from './common/logging/logger.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClinicSettingsModule } from './modules/clinic-settings/clinic-settings.module';
import { EmailModule } from './modules/email/email.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { PatientsModule } from './modules/patients/patients.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { ErrorRateMiddleware } from './modules/telemetry/error-counter';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    LoggingModule,
    PrismaModule,
    AuditModule,
    EmailModule,
    RateLimitModule,
    JobsModule,
    HealthModule,
    TelemetryModule,
    AuthModule,
    AdminModule,
    ClinicSettingsModule,
    PatientsModule,
  ],
  providers: [
    // RolesGuard is global so `@Roles()` works on any handler without
    // each controller needing to register it. The AuthGuard /
    // ClinicScopeGuard are not global because they need granular
    // skipping via `@AllowAnonymous()` / `@AdminScope()` — registered
    // per controller instead.
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // ClinicResolutionMiddleware runs FIRST so every downstream
    // handler has a populated `req.ctx` with the tenant clinic_id
    // (or admin/apex scope). It also seeds `userId`/`clinicId` for
    // the Pino logger's customProps.
    consumer.apply(ClinicResolutionMiddleware).forRoutes('*');
    // Counts every 5xx response (sampled and reset by the telemetry
    // collector each minute). Registered globally so health/* and
    // /api/telemetry/* are both counted — a misbehaving heartbeat
    // receiver should still show up in the host's error rate.
    consumer.apply(ErrorRateMiddleware).forRoutes('*');
  }
}
