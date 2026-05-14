import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { VisitsController } from './visits.controller';
import { VisitsService } from './visits.service';
import { VisitsCalendarController } from './visits-calendar.controller';
import { VisitsCalendarEventsService } from './visits-calendar.events';
import { VisitsCalendarService } from './visits-calendar.service';

/**
 * Visits — unified module covering both surfaces of the merged table
 * (ADR-011, Phase 2a).
 *
 *   VisitsCalendarController: receptionist-facing routes
 *     (`/api/visits/calendar/*`, `/api/visits/scheduled`,
 *     `/api/visits/walkin`, `/api/visits/:id/scheduling`,
 *     `/api/visits/:id/status`)
 *   VisitsController: doctor-facing routes
 *     (`POST /api/visits`, `GET /api/visits/:id`, `PATCH /api/visits/:id`,
 *     `DELETE /api/visits/:id`, `POST /api/visits/:id/restore`,
 *     `GET /api/visits/:id/history`)
 *
 * Controller order is load-bearing: Express resolves routes
 * first-match-wins, so the calendar's more-specific paths
 * (`/calendar`, `:id/status`, `:id/scheduling`) MUST be registered
 * before the doctor's catch-all `:id` patterns. Don't reorder.
 *
 * `VisitsCalendarEventsService` exports its in-process SSE bus so the
 * doctor's home dashboard can subscribe to the same calendar lifecycle
 * stream as the receptionist.
 */
@Module({
  imports: [AuthModule],
  controllers: [VisitsCalendarController, VisitsController],
  providers: [VisitsService, VisitsCalendarService, VisitsCalendarEventsService],
  exports: [VisitsService, VisitsCalendarService, VisitsCalendarEventsService],
})
export class VisitsModule {}
