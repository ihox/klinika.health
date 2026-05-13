import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_METADATA_KEY, type AppRole } from '../decorators/roles.decorator';
import type { RequestWithContext } from '../request-context/request-context';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(executionContext: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AppRole[] | undefined>(
      ROLES_METADATA_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }
    const req = executionContext.switchToHttp().getRequest<RequestWithContext>();
    const role = req.ctx?.role;
    if (!role || !required.includes(role)) {
      throw new ForbiddenException('Roli juaj nuk ka qasje në këtë veprim.');
    }
    return true;
  }
}
