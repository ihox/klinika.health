import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { PrintController } from './print.controller';
import {
  PRINT_RENDERER,
  PrintRendererProxy,
  PuppeteerRenderer,
} from './print-renderer.service';
import { PrintService } from './print.service';

/**
 * Print pipeline module.
 *
 * Wires the renderer (Puppeteer pool) behind the {@link PRINT_RENDERER}
 * token. Tests can swap the implementation via
 * `.overrideProvider(PRINT_RENDERER)`.
 *
 * Imports AuthModule so the controller guards resolve SessionService
 * at module instantiation time. PrismaModule + AuditModule are global.
 */
@Module({
  imports: [AuthModule],
  controllers: [PrintController],
  providers: [
    PrintService,
    PuppeteerRenderer,
    {
      provide: PRINT_RENDERER,
      useExisting: PuppeteerRenderer,
    },
    PrintRendererProxy,
  ],
  exports: [PrintService, PrintRendererProxy, PRINT_RENDERER],
})
export class PrintModule {}
