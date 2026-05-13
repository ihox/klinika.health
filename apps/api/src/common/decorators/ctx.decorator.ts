import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { RequestContext, RequestWithContext } from '../request-context/request-context';

/**
 * Controller parameter decorator: pulls the populated RequestContext
 * out of the Express request. The middleware chain (clinic resolution,
 * auth guard) writes `req.ctx` so by the time a controller method
 * runs, it's always present.
 *
 * Usage:
 *   @Get(':id')
 *   findOne(@Param('id') id: string, @Ctx() ctx: RequestContext) {...}
 */
export const Ctx = createParamDecorator(
  (_data: unknown, executionContext: ExecutionContext): RequestContext => {
    const req = executionContext.switchToHttp().getRequest<RequestWithContext>();
    if (!req.ctx) {
      throw new Error(
        'RequestContext missing — ClinicResolutionMiddleware must run before this handler.',
      );
    }
    return req.ctx;
  },
);
