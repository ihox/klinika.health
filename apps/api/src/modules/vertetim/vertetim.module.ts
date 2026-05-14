import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VertetimController } from './vertetim.controller';
import { VertetimService } from './vertetim.service';

/**
 * Vërtetim issue + fetch surface. Print rendering lives in the
 * sibling Print module.
 *
 * Imports AuthModule so the controller's AuthGuard / ClinicScopeGuard
 * can resolve SessionService. PrismaModule + AuditModule are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [VertetimController],
  providers: [VertetimService],
  exports: [VertetimService],
})
export class VertetimModule {}
