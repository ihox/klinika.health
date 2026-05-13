import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { InjectPinoLogger, type PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../prisma/prisma.service';

export interface RateLimitConfig {
  scope: string;
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = {
  loginIp: { scope: 'auth.login.ip', limit: 5, windowSeconds: 60 },
  loginEmail: { scope: 'auth.login.email', limit: 10, windowSeconds: 3600 },
  mfaSend: { scope: 'auth.mfa.send', limit: 3, windowSeconds: 60 },
  mfaVerify: { scope: 'auth.mfa.verify', limit: 5, windowSeconds: 60 },
  passwordResetRequest: { scope: 'auth.password-reset.request', limit: 3, windowSeconds: 3600 },
  apiUser: { scope: 'api.user', limit: 100, windowSeconds: 60 },
  apiAnon: { scope: 'api.anon', limit: 30, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitConfig>;

export class RateLimitedException extends HttpException {
  constructor(retryAfterSeconds: number, scope: string) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Tepër kërkesa. Provoni përsëri pas pak.',
        retryAfterSeconds,
        scope,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Postgres-backed sliding window rate limiter. Upserts on `(scope,
 * key)`. The window resets when `window_ends_at` is in the past — we
 * also drop the count to 1 atomically in that case. The atomic insert
 * uses ON CONFLICT so two parallel requests can never bypass the
 * limit via a TOCTOU race.
 *
 * Errors `throw RateLimitedException` which the global filter
 * translates to 429 with a `Retry-After` header.
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectPinoLogger(RateLimitService.name)
    private readonly logger: PinoLogger,
  ) {}

  async consume(config: RateLimitConfig, key: string): Promise<void> {
    const now = new Date();
    const nextWindowEnd = new Date(now.getTime() + config.windowSeconds * 1000);

    // CTE: insert a fresh row if none, otherwise either reset+set=1
    // (if window expired) or increment count. Returns the resulting
    // count and the window end timestamp.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ count: number; window_ends_at: Date }>
    >(
      `INSERT INTO "rate_limits" ("scope", "key", "count", "window_ends_at", "created_at", "updated_at")
       VALUES ($1, $2, 1, $3, $4, $4)
       ON CONFLICT ("scope", "key") DO UPDATE
         SET "count" = CASE WHEN "rate_limits"."window_ends_at" < $4 THEN 1 ELSE "rate_limits"."count" + 1 END,
             "window_ends_at" = CASE WHEN "rate_limits"."window_ends_at" < $4 THEN $3 ELSE "rate_limits"."window_ends_at" END,
             "updated_at" = $4
       RETURNING "count" AS "count", "window_ends_at" AS "window_ends_at"`,
      config.scope,
      key,
      nextWindowEnd,
      now,
    );

    const result = rows[0];
    if (!result) {
      // Defensive — the UPSERT always returns one row, but if Postgres
      // ever surprises us we fail OPEN rather than blackholing legit
      // traffic. Mistake gets a warn log.
      this.logger.warn({ scope: config.scope, key }, 'Rate limit upsert returned no rows');
      return;
    }

    if (result.count > config.limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(result.window_ends_at).getTime() - now.getTime()) / 1000),
      );
      this.logger.warn(
        { scope: config.scope, key, count: result.count, retryAfter },
        'Rate limit exceeded',
      );
      throw new RateLimitedException(retryAfter, config.scope);
    }
  }
}
