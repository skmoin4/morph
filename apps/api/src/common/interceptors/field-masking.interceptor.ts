import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { forbiddenFieldsFor, maskSensitiveFields } from '../masking/sensitive-fields';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * Strips sensitive fields from every response, based on the caller's
 * permissions. Applied globally so a new endpoint is protected by default
 * rather than by remembering to narrow its `select`.
 */
@Injectable()
export class FieldMaskingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    if (!user) return next.handle();

    const forbidden = forbiddenFieldsFor(user);
    if (forbidden.size === 0) return next.handle();

    return next.handle().pipe(map((body) => maskSensitiveFields(body, forbidden)));
  }
}
