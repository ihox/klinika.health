import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { LoggingModule } from './common/logging/logger.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ErrorRateMiddleware } from './modules/telemetry/error-counter';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    LoggingModule,
    PrismaModule,
    JobsModule,
    HealthModule,
    TelemetryModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Counts every 5xx response (sampled and reset by the telemetry
    // collector each minute). Registered globally so health/* and
    // /api/telemetry/* are both counted — a misbehaving heartbeat
    // receiver should still show up in the host's error rate.
    consumer.apply(ErrorRateMiddleware).forRoutes('*');
  }
}
