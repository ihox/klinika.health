import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  // Behind Caddy / Cloudflare Tunnel; X-Forwarded-For is trusted and
  // the leftmost entry is the real client IP. The request-context
  // helper extracts it; this just makes Express stop second-guessing.
  app.set('trust proxy', true);

  // Tenant subdomains (`*.klinika.health`) and the apex/admin host
  // share the same API origin pattern. Allowing credentials is
  // required for the session cookie to round-trip. Wildcards are
  // expanded against the explicit allow-list at request time.
  const corsOrigin = (process.env['CORS_ORIGIN'] ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      // Exact match against the configured list, OR a *.klinika.health subdomain.
      const ok =
        corsOrigin.includes(origin) ||
        /^https:\/\/[a-z0-9][a-z0-9-]{0,40}\.klinika\.health$/.test(origin) ||
        origin === 'https://klinika.health' ||
        origin === 'https://app.klinika.health' ||
        origin === 'https://admin.klinika.health';
      callback(null, ok);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Controllers carry their own `api/...` prefix where applicable
  // (matches telemetry's existing convention). `health` stays at the
  // root so health probes don't need to know about the API mount
  // point.

  const port = Number(process.env['API_PORT'] ?? 3001);
  const host = process.env['API_HOST'] ?? '0.0.0.0';

  app.enableShutdownHooks();
  await app.listen(port, host);
}

void bootstrap();
