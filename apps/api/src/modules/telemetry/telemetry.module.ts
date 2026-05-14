import { Module } from '@nestjs/common';

import { DicomModule } from '../dicom/dicom.module';
import { HealthModule } from '../health/health.module';
import { AlertEngineService } from './alert-engine.service';
import { ErrorRateCounter } from './error-counter';
import { HeartbeatReceiverController } from './heartbeat-receiver.controller';
import { HeartbeatSenderService } from './heartbeat-sender.service';
import { TelemetryCollectorService } from './telemetry-collector.service';
import { TelemetryService } from './telemetry.service';

@Module({
  imports: [HealthModule, DicomModule],
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
