import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Tiny in-process counter for 5xx responses, sampled by the telemetry
 * agent each minute and then zeroed. Lives outside the telemetry
 * service so it can be wired in `app.module` before the telemetry
 * module loads, and so tests can stub it without bringing the whole
 * agent online.
 *
 * Counts are intentionally lossy — if the process restarts mid-minute,
 * any pending count is gone. That's fine: this is a coarse health
 * signal, not a precise SLO calculation.
 */
@Injectable()
export class ErrorRateCounter {
  private count = 0;

  increment(): void {
    this.count += 1;
  }

  /** Return current count and reset to zero. */
  drain(): number {
    const v = this.count;
    this.count = 0;
    return v;
  }
}

@Injectable()
export class ErrorRateMiddleware implements NestMiddleware {
  constructor(private readonly counter: ErrorRateCounter) {}

  use(_req: Request, res: Response, next: NextFunction): void {
    res.on('finish', () => {
      if (res.statusCode >= 500) {
        this.counter.increment();
      }
    });
    next();
  }
}
