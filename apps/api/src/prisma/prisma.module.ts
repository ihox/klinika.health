import { Global, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import { PrismaService } from './prisma.service';

// Marked @Global so any feature module can inject PrismaService without
// importing PrismaModule. Connection management still happens once via
// onModuleInit / onModuleDestroy.
@Global()
@Module({
  imports: [LoggerModule.forRoot()],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
