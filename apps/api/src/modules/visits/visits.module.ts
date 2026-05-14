import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';

/**
 * Visits — the doctor's auto-saved clinical form.
 *
 * Imports AuthModule so AuthGuard / ClinicScopeGuard resolve the
 * session at controller binding time. PrismaModule and AuditModule
 * are global (registered in AppModule).
 */
@Module({
  imports: [AuthModule],
  controllers: [VisitsController],
  providers: [VisitsService],
  exports: [VisitsService],
})
export class VisitsModule {}
