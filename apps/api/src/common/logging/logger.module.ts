import { Global, Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';

import { buildLoggerConfig } from './logger.config';

// Single source of LoggerModule.forRoot for the whole app. PrismaModule
// used to call LoggerModule.forRoot() itself with defaults; that's now
// removed in favor of this @Global module so PHI redaction and request-
// ID propagation apply uniformly.
@Global()
@Module({
  imports: [PinoLoggerModule.forRoot(buildLoggerConfig())],
  exports: [PinoLoggerModule],
})
export class LoggingModule {}
