import { Module } from '@nestjs/common';

import { HealthModule } from '../health/health.module';
import { AlertEngineService } from './alert-engine.service';
import { ErrorRateCounter } from './error-counter';
import { HeartbeatReceiverController } from './heartbeat-receiver.controller';
import { HeartbeatSenderService } from './heartbeat-sender.service';
import { TelemetryCollectorService } from './telemetry-collector.service';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [HealthModule],
  controllers: [HeartbeatReceiverController],
  providers: [
    AlertEngineService,
    ErrorRateCounter,
    HeartbeatSenderService,
    TelemetryCollectorService,
    TelemetryService,
  ],
  exports: [ErrorRateCounter, TelemetryService, AlertEngineService],
})
export class TelemetryModule {}
