import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TrustedDeviceService } from './trusted-device.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, MfaService, TrustedDeviceService],
  exports: [AuthService, PasswordService, SessionService, MfaService, TrustedDeviceService],
})
export class AuthModule {}
