import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsEventsService } from './appointments.events';
import { AppointmentsService } from './appointments.service';

/**
 * Appointment scheduling — receptionist's daily surface.
 *
 * Imports AuthModule so AuthGuard (applied per-route on the controller)
 * can resolve SessionService at module instantiation time.
 *
 * Re-exports `AppointmentsService` so slice 12 (visit save) can call
 * `markCompletedFromVisit` after the doctor saves a chart that lines
 * up with a scheduled appointment.
 */
@Module({
  imports: [AuthModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsEventsService],
  exports: [AppointmentsService, AppointmentsEventsService],
})
export class AppointmentsModule {}
