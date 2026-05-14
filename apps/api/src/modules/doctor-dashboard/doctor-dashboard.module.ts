import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DoctorDashboardController } from './doctor-dashboard.controller';
import { DoctorDashboardService } from './doctor-dashboard.service';

// AuthModule is imported so AuthGuard (applied per-route on the
// controller) can resolve SessionService. Without it the module fails
// to instantiate at boot.
@Module({
  imports: [AuthModule],
  controllers: [DoctorDashboardController],
  providers: [DoctorDashboardService],
  exports: [DoctorDashboardService],
})
export class DoctorDashboardModule {}
