import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';

import { PHI_REDACT_CENSOR, PHI_REDACT_PATHS } from './redaction';

const REQUEST_ID_HEADER = 'x-request-id';

type ReqWithCtx = IncomingMessage & {
  userId?: string;
  clinicId?: string;
};

/**
 * nestjs-pino configuration: structured JSON in production, pretty in
 * development, with PHI redaction enabled in every environment.
 *
 * - Request IDs come from the `x-request-id` header when supplied by
 *   the frontend (so a Pino line on the API can be correlated to a
 *   browser-side React error). Otherwise we mint a UUID v4 per request.
 *   The chosen ID is echoed back as `x-request-id` so the browser side
 *   sees what we logged it under.
 * - `userId` and `clinicId` are attached to the request by Auth /
 *   ClinicScope guards (later slices). Until then, `customProps` simply
 *   omits them from each log line, but the wiring is in place.
 * - In tests, set `LOG_LEVEL=silent` (or rely on the NODE_ENV=test
 *   override) so vitest output isn't drowned in request logs.
 */
export function buildLoggerConfig(): Params {
  const env = process.env['NODE_ENV'] ?? 'development';
  const isProd = env === 'production';
  const isTest = env === 'test';

  const level =
    process.env['LOG_LEVEL'] ?? (isTest ? 'silent' : isProd ? 'info' : 'debug');

  return {
    pinoHttp: {
      level,
      genReqId: (req: IncomingMessage, res: ServerResponse): string => {
        const hdr = req.headers[REQUEST_ID_HEADER];
        const id = (Array.isArray(hdr) ? hdr[0] : hdr) ?? randomUUID();
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      // The default `req`/`res` serializers from pino-http include
      // headers and URL — both safe (no PHI per CLAUDE.md §1.4: opaque
      // UUIDs only in URLs). Bodies are NOT serialized by default.
      customProps: (req: IncomingMessage) => {
        const r = req as ReqWithCtx;
        const props: Record<string, unknown> = {};
        if (r.userId) {
          props['userId'] = r.userId;
        }
        if (r.clinicId) {
          props['clinicId'] = r.clinicId;
        }
        return props;
      },
      redact: {
        paths: [...PHI_REDACT_PATHS],
        censor: PHI_REDACT_CENSOR,
        remove: false,
      },
      // ISO timestamp suits human + structured ingest equally; epoch
      // millis would be cheaper but would force every operator to
      // mentally convert when reading logs.
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      messageKey: 'message',
      formatters: {
        level: (label: string) => ({ level: label }),
      },
      ...(isProd
        ? {}
        : {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: false,
                translateTime: 'SYS:HH:MM:ss.l',
                ignore: 'pid,hostname',
                messageKey: 'message',
              },
            },
          }),
      // pino-http auto-logs every request at `info`; for endpoints like
      // /health/ready that fire every 30s from the frontend this would
      // be very noisy. Drop them to `debug` so production stays quiet.
      customLogLevel: (
        req: IncomingMessage,
        res: ServerResponse,
        err?: Error,
      ) => {
        if (err || res.statusCode >= 500) {
          return 'error' as const;
        }
        if (res.statusCode >= 400) {
          return 'warn' as const;
        }
        const url = (req as IncomingMessage & { url?: string }).url ?? '';
        if (url.startsWith('/health')) {
          return 'debug' as const;
        }
        return 'info' as const;
      },
    },
  };
}

export const REQUEST_ID_HEADER_NAME = REQUEST_ID_HEADER;
