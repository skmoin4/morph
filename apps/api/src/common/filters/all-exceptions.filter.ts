import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';

/** Single error shape for the whole API: { code, message, details }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong.';
    let details: unknown;

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // A constraint violation is the caller's problem, not a server fault —
      // reporting it as a 500 hides a perfectly actionable conflict.
      const mapped = mapPrismaError(exception);
      status = mapped.status;
      code = mapped.code;
      message = mapped.message;
      details = mapped.details;
      if (status >= 500) this.logger.error(exception.message, exception.stack);
    } else if (exception instanceof ZodError) {
      status = HttpStatus.UNPROCESSABLE_ENTITY;
      code = 'VALIDATION_ERROR';
      message = 'The submitted data is not valid.';
      details = exception.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        message = (b.message as string) ?? exception.message;
        code = (b.code as string) ?? httpStatusToCode(status);
        details = b.details;
      }
      if (code === 'INTERNAL_ERROR') code = httpStatusToCode(status);

      // Nest's ThrottlerException leaks its class name into the message.
      if (status === HttpStatus.TOO_MANY_REQUESTS) {
        message = 'Too many attempts. Wait a minute and try again.';
      }
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    res.status(status).json({
      code,
      message,
      ...(details === undefined ? {} : { details }),
      requestId: req.requestId,
    });
  }
}

/** Translates the Prisma error codes that represent a caller mistake. */
function mapPrismaError(error: Prisma.PrismaClientKnownRequestError): {
  status: number;
  code: string;
  message: string;
  details?: unknown;
} {
  const target = (error.meta?.target as string[] | string | undefined) ?? undefined;
  const fields = Array.isArray(target) ? target.join(', ') : target;

  switch (error.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        code: 'DUPLICATE',
        message: fields
          ? `Another record already uses that ${fields}.`
          : 'Another record with these details already exists.',
        details: fields ? { fields } : undefined,
      };
    case 'P2003':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'INVALID_REFERENCE',
        message: 'That references something which does not exist.',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'That record was not found.',
      };
    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong.',
      };
  }
}

function httpStatusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHENTICATED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 429:
      return 'RATE_LIMITED';
    default:
      return 'INTERNAL_ERROR';
  }
}
