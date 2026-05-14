import { Module } from '@nestjs/common';

import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

/**
 * Patient master data and search surface.
 *
 * Imports the global AuditModule + PrismaModule (already wired in
 * `AppModule`); no clinic-specific dependencies beyond `RequestContext`
 * propagation handled by the common middleware chain.
 *
 * The module re-exports `PatientsService` so slice 9 (booking) can
 * `findById` for read-only embedding in the booking dialog without
 * adding a second HTTP hop.
 */
@Module({
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
