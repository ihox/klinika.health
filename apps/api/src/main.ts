import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Logo (2 MB) and signature (1 MB) uploads are base64-encoded in
    // the request body, so the raw JSON ceiling needs ~6 MB
    // headroom. Per-route handlers still enforce byte-level limits
    // via Zod + an explicit byte check; this only raises the
    // framework default (100 KB) so large uploads don't 413 before
    // reaching the controller's validation. Switching off Nest's
    // default body parser and re-registering with a higher limit
    // avoids importing `express` directly from our code.
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '6mb' });
  app.useBodyParser('urlencoded', { limit: '6mb', extended: true });

  app.useLogger(app.get(Logger));

  // Behind Caddy / Cloudflare Tunnel; X-Forwarded-For is trusted and
  // the leftmost entry is the real client IP. The request-context
  // helper extracts it; this just makes Express stop second-guessing.
  app.set('trust proxy', true);

  // Tenant subdomains (`*.${CLINIC_HOST_SUFFIX}`) and the apex host
  // share the same API origin pattern. Allowing credentials is
  // required for the session cookie to round-trip. Wildcards are
  // expanded against the suffix at request time so the same code
  // works on production (klinika.health) and staging
  // (klinika.health.ihox.net) without touching app code.
  const corsOrigin = (process.env['CORS_ORIGIN'] ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const hostSuffix = process.env['CLINIC_HOST_SUFFIX'] || 'klinika.health';
  const escapedSuffix = hostSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tenantOriginRegex = new RegExp(
    `^https:\\/\\/[a-z0-9][a-z0-9-]{0,40}\\.${escapedSuffix}$`,
  );
  const apexOrigin = `https://${hostSuffix}`;
  const appOrigin = `https://app.${hostSuffix}`;
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      // Exact match against the configured list, OR a tenant
      // subdomain under the configured suffix, OR the apex / app
      // host (platform). The admin context lives on the apex —
      // never on admin.<suffix>.
      const ok =
        corsOrigin.includes(origin) ||
        tenantOriginRegex.test(origin) ||
        origin === apexOrigin ||
        origin === appOrigin;
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
