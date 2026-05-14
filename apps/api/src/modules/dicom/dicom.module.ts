import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DicomController } from './dicom.controller';
import { DicomService } from './dicom.service';
import { OrthancClient } from './orthanc.client';

/**
 * Klinika ↔ Orthanc bridge.
 *
 * The OrthancClient is exported so the telemetry module can probe
 * storage usage for the hourly heartbeat (see ADR-009 monitoring).
 * Imports AuthModule so the controller guards resolve SessionService
 * at module instantiation time. PrismaModule + AuditModule are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [DicomController],
  providers: [DicomService, OrthancClient],
  exports: [DicomService, OrthancClient],
})
export class DicomModule {}
