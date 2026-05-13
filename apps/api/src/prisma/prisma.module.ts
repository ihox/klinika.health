import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

// Marked @Global so any feature module can inject PrismaService without
// importing PrismaModule. Connection management still happens once via
// onModuleInit / onModuleDestroy. The Pino logger comes from
// `LoggingModule` (also @Global) — both are wired in AppModule.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
