import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { openRequestScope } from '../../prisma/tenant-context';

/**
 * Tags every request so logs, audit rows and error bodies can be correlated,
 * and opens the tenant scope the JWT guard will later fill in.
 *
 * Opening the scope here — in middleware, around `next()` — is what makes the
 * company id visible to every Prisma query later in the request.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
    res.setHeader('x-request-id', req.requestId);

    openRequestScope(() => next());
  }
}
