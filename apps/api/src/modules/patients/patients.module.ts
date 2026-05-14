import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';

/**
 * Patient master data and search surface.
 *
 * Imports AuthModule so AuthGuard (applied per-route on the controller)
 * can resolve SessionService at module instantiation time. The global
 * AuditModule + PrismaModule are already wired in AppModule.
 *
 * The module re-exports `PatientsService` so slice 9 (booking) can
 * `findById` for read-only embedding in the booking dialog without
 * adding a second HTTP hop.
 */
@Module({
  imports: [AuthModule],
  controllers: [PatientsController],
  providers: [PatientsService],
  exports: [PatientsService],
})
export class PatientsModule {}
