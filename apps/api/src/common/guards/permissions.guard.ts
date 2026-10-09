import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Enforces action-level access: every key on `@RequirePermissions(...)` must be
 * granted. Data scope is applied separately, as a query filter.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this action.',
      });
    }

    const missing = required.filter((key) => !user.permissions.has(key));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this action.',
        details: { missingPermissions: missing },
      });
    }

    return true;
  }
}
