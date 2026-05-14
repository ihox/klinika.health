import { Module } from '@nestjs/common';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsEventsService } from './appointments.events';
import { AppointmentsService } from './appointments.service';

/**
 * Appointment scheduling — receptionist's daily surface.
 *
 * Re-exports `AppointmentsService` so slice 12 (visit save) can call
 * `markCompletedFromVisit` after the doctor saves a chart that lines
 * up with a scheduled appointment.
 */
@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsEventsService],
  exports: [AppointmentsService, AppointmentsEventsService],
})
export class AppointmentsModule {}
