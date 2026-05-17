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

  // Tenant + apex origins share the same API. Allowing credentials is
  // required for the session cookie to round-trip. The accepted-host
  // pattern is built from env so production (suffix mode:
  // `*.klinika.health`) and staging (prefix mode:
  // `klinika-health-*.ihox.net`) work from the same code path. See
  // {@link HostResolutionConfig} in the tenancy middleware for the
  // two-mode rationale.
  const corsOrigin = (process.env['CORS_ORIGIN'] ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  const hostApex = process.env['CLINIC_HOST_APEX'];
  const hostPrefix = process.env['CLINIC_HOST_PREFIX'];
  const hostSuffix = process.env['CLINIC_HOST_SUFFIX'] || 'klinika.health';
  const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let tenantOriginRegex: RegExp;
  let apexOrigin: string;
  let appOrigin: string;
  if (hostApex && hostPrefix) {
    // Prefix mode (staging). Tenants are sibling FQDNs sharing the
    // apex's parent domain. For apex `klinika-health.ihox.net`:
    // parent = `ihox.net`, prefix = `klinika-health-`, accepted tenant
    // origins look like `https://klinika-health-<slug>.ihox.net`.
    const parentDotIdx = hostApex.indexOf('.');
    const parentDomain = parentDotIdx > 0 ? hostApex.slice(parentDotIdx + 1) : hostApex;
    tenantOriginRegex = new RegExp(
      `^https:\\/\\/${escapeForRegex(hostPrefix)}[a-z0-9][a-z0-9-]{0,40}\\.${escapeForRegex(parentDomain)}$`,
    );
    apexOrigin = `https://${hostApex}`;
    // No separate `app.<apex>` in prefix mode — reuse the apex origin
    // so the check below stays uniform.
    appOrigin = apexOrigin;
  } else {
    // Suffix mode (production).
    tenantOriginRegex = new RegExp(
      `^https:\\/\\/[a-z0-9][a-z0-9-]{0,40}\\.${escapeForRegex(hostSuffix)}$`,
    );
    apexOrigin = `https://${hostSuffix}`;
    appOrigin = `https://app.${hostSuffix}`;
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      // Exact match against the configured list, OR a tenant subdomain
      // matching the active mode's pattern, OR the apex / app host.
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
