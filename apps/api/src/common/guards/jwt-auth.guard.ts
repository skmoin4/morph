import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { attachTenantToRequestScope } from '../../prisma/tenant-context';
import { UserPermissionsService } from '../../modules/auth/user-permissions.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AccessTokenPayload, AuthenticatedUser } from '../types/authenticated-user';

/**
 * Verifies the access token, loads the user's permissions, and opens the tenant
 * scope for the rest of the request.
 *
 * Registered globally: a route is protected unless it is marked `@Public()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UserPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const token = extractBearerToken(request);
    if (!token) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Sign in to continue.',
      });
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Your session has expired. Sign in again.',
      });
    }

    const loaded = await this.users.load(payload.sub, payload.cid);
    if (!loaded) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'Your account is no longer available.',
      });
    }
    if (loaded.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'ACCOUNT_INACTIVE',
        message: 'This account is not active. Contact your administrator.',
      });
    }

    request.user = loaded.user;

    // Fills in the scope the request-context middleware opened. From here on,
    // every Prisma query in this request is scoped to the company on the token.
    attachTenantToRequestScope({
      companyId: loaded.user.companyId,
      userId: loaded.user.userId,
      employeeId: loaded.user.employeeId,
      requestId: (request as Request & { requestId?: string }).requestId,
    });

    return true;
  }
}

function extractBearerToken(request: Request): string | null {
  const header = request.header('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
