import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ClinicAuditService } from './clinic-audit.service';
import { ClinicSettingsController } from './clinic-settings.controller';
import { ClinicSettingsService } from './clinic-settings.service';
import { ClinicStorageService } from './clinic-storage.service';
import { ClinicUsersService } from './clinic-users.service';
import { SmtpTestService } from './smtp-test.service';

/**
 * Clinic-settings surface: `/api/clinic/settings/*`,
 * `/api/clinic/users/*`, `/api/clinic/audit/*`, plus the authenticated
 * file proxies (`/api/clinic/logo`, `/api/clinic/signature`).
 *
 * Imports {@link AuthModule} for the password service and the
 * password-reset helper used when an admin sends a reset email to a
 * staff member.
 */
@Module({
  imports: [AuthModule],
  controllers: [ClinicSettingsController],
  providers: [
    ClinicSettingsService,
    ClinicUsersService,
    ClinicAuditService,
    ClinicStorageService,
    SmtpTestService,
  ],
  exports: [ClinicStorageService, SmtpTestService],
})
export class ClinicSettingsModule {}
