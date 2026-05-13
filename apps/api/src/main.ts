import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  const port = Number(process.env['API_PORT'] ?? 3001);
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
