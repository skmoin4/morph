import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

/**
 * Parses a request payload with a Zod schema from `@opsvera/shared`, so the API
 * and the web form validate against exactly the same rules.
 *
 * ZodErrors are turned into the standard `{ code, message, details }` body by
 * the global exception filter.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    return this.schema.parse(value);
  }
}

/** Shorthand for `new ZodValidationPipe(schema)` at a parameter. */
export const zodPipe = <T>(schema: ZodSchema<T>) => new ZodValidationPipe(schema);
